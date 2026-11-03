/*
 * ============================================================================
 *  Module   : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Fichier  : firmware/src/main.cpp – station FloodWatch (ESP32)
 *  Équipe   : FloodWatch – Auteur : Ksontini Amine
 *  Version  : 1.0 – 2026-11-02
 * ============================================================================
 *  Fonctions :
 *   - mesure du niveau d'eau (HC-SR04, médiane de 5 échos) et de la pluie (ADC) ;
 *   - publication MQTT : telemetry, heartbeat (15 s), state (retenu), status (LWT retenu) ;
 *   - exécution des commandes Cloud (barrière, feu, sirène, période) avec acquittement ;
 *   - seuils reçus du Cloud (topic config retenu) et stockés en flash (NVS) ;
 *   - RÈGLE DE SÉCURITÉ LOCALE : au-delà du seuil rouge, la station ferme elle-même la
 *     barrière, passe le feu au rouge et déclenche la sirène, même sans Wi-Fi ni Cloud.
 *     Réouverture seulement après retour sous le seuil orange pendant la temporisation.
 *   - verrou de sécurité : une commande d'ouverture est refusée au-dessus du seuil rouge.
 * ============================================================================
 */
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>
#include <Preferences.h>
#include "station_config.h"

static const char *FW_VERSION = "1.0.0";
static const uint32_t HEARTBEAT_MS = 15000;

// ----------------------------------------------------------------------------- configuration (NVS)
struct Config {
  float criticalCm = 20, yellowPct = 30, orangePct = 60, redPct = 85;
  float rainThreshold = 0.2f, sensorHeightCm = 30;
  uint32_t reopenDelaySec = 60, periodNormalSec = 30, periodWatchSec = 5;
} cfg;

// ----------------------------------------------------------------------------- état
enum class Light { GREEN, ORANGE, RED, OFF };
struct State {
  bool barrierClosed = false;
  Light light = Light::GREEN;
  bool siren = false;
  bool cloudWatch = false;        // surveillance renforcée demandée par le Cloud
  bool localSafety = false;       // fermeture autonome en cours
} st;

float levelCm = 0, rain = 0;
bool sensorOk = true;
uint32_t belowOrangeSinceMs = 0;
uint32_t lastMeasureMs = 0, lastHeartbeatMs = 0, lastMqttTryMs = 0, lastWifiTryMs = 0;
uint32_t seq = 0;

Preferences prefs;
Servo barrier;
#if USE_TLS
WiFiClientSecure net;
#else
WiFiClient net;
#endif
PubSubClient mqtt(net);
String tTelemetry, tHeartbeat, tState, tStatus, tAck, tCmd, tConfig;

// ----------------------------------------------------------------------------- utilitaires
const char *lightName(Light l) {
  switch (l) {
    case Light::GREEN: return "GREEN";
    case Light::ORANGE: return "ORANGE";
    case Light::RED: return "RED";
    default: return "OFF";
  }
}

float levelPct() { return 100.0f * levelCm / cfg.criticalCm; }

bool watchMode() {
  return st.cloudWatch || rain >= cfg.rainThreshold || levelPct() >= cfg.yellowPct;
}

void loadConfig() {
  prefs.begin("floodwatch", true);
  cfg.criticalCm = prefs.getFloat("crit", cfg.criticalCm);
  cfg.yellowPct = prefs.getFloat("yel", cfg.yellowPct);
  cfg.orangePct = prefs.getFloat("ora", cfg.orangePct);
  cfg.redPct = prefs.getFloat("red", cfg.redPct);
  cfg.rainThreshold = prefs.getFloat("rain", cfg.rainThreshold);
  cfg.sensorHeightCm = prefs.getFloat("hgt", cfg.sensorHeightCm);
  cfg.reopenDelaySec = prefs.getUInt("reo", cfg.reopenDelaySec);
  cfg.periodNormalSec = prefs.getUInt("pn", cfg.periodNormalSec);
  cfg.periodWatchSec = prefs.getUInt("pw", cfg.periodWatchSec);
  prefs.end();
}

void saveConfig() {
  prefs.begin("floodwatch", false);
  prefs.putFloat("crit", cfg.criticalCm);
  prefs.putFloat("yel", cfg.yellowPct);
  prefs.putFloat("ora", cfg.orangePct);
  prefs.putFloat("red", cfg.redPct);
  prefs.putFloat("rain", cfg.rainThreshold);
  prefs.putFloat("hgt", cfg.sensorHeightCm);
  prefs.putUInt("reo", cfg.reopenDelaySec);
  prefs.putUInt("pn", cfg.periodNormalSec);
  prefs.putUInt("pw", cfg.periodWatchSec);
  prefs.end();
}

// ----------------------------------------------------------------------------- actionneurs
void applyOutputs() {
  barrier.write(st.barrierClosed ? SERVO_CLOSED_DEG : SERVO_OPEN_DEG);
  digitalWrite(PIN_LED_RED, st.light == Light::RED);
  digitalWrite(PIN_LED_ORANGE, st.light == Light::ORANGE);
  digitalWrite(PIN_LED_GREEN, st.light == Light::GREEN);
  if (!st.siren) digitalWrite(PIN_BUZZER, LOW);
}

/** Sirène intermittente non bloquante (500 ms). */
void updateSiren() {
  if (st.siren) digitalWrite(PIN_BUZZER, (millis() / 500) % 2);
}

void publishState() {
  if (!mqtt.connected()) return;
  JsonDocument doc;
  doc["barrier"] = st.barrierClosed ? "CLOSED" : "OPEN";
  doc["light"] = lightName(st.light);
  doc["siren"] = st.siren;
  doc["sampling"] = watchMode() ? "WATCH" : "NORMAL";
  doc["localSafety"] = st.localSafety;
  char buf[192];
  size_t n = serializeJson(doc, buf);
  mqtt.publish(tState.c_str(), (const uint8_t *)buf, n, true);
}

// ----------------------------------------------------------------------------- capteurs
/** Distance HC-SR04 (cm), médiane de 5 mesures ; -1 si aucun écho. */
float readDistanceCm() {
  float v[5];
  int ok = 0;
  for (int i = 0; i < 5; i++) {
    digitalWrite(PIN_TRIG, LOW);
    delayMicroseconds(3);
    digitalWrite(PIN_TRIG, HIGH);
    delayMicroseconds(10);
    digitalWrite(PIN_TRIG, LOW);
    unsigned long us = pulseIn(PIN_ECHO, HIGH, 30000UL);
    if (us > 0) v[ok++] = us * 0.0343f / 2.0f;
    delay(30);
  }
  if (ok < 3) return -1;
  for (int i = 1; i < ok; i++)  // tri par insertion
    for (int j = i; j > 0 && v[j - 1] > v[j]; j--) { float t = v[j]; v[j] = v[j - 1]; v[j - 1] = t; }
  return v[ok / 2];
}

float readRain() {
  int raw = analogRead(PIN_RAIN_AO);
  float r = (float)(RAIN_DRY_RAW - raw) / (float)(RAIN_DRY_RAW - RAIN_WET_RAW);
  return constrain(r, 0.0f, 1.0f);
}

void measure() {
  float d = readDistanceCm();
  sensorOk = d > 0 && d <= cfg.sensorHeightCm + 5;
  if (sensorOk) levelCm = max(0.0f, cfg.sensorHeightCm - d);
  rain = readRain();
}

// ----------------------------------------------------------------------------- sécurité locale
/** Règle de sécurité locale (mode dégradé) : ne dépend ni du Wi-Fi ni du Cloud. */
void localSafetyRule() {
  if (!sensorOk) return;  // pas de décision sur une mesure invalide
  float pct = levelPct();
  bool changed = false;
  if (pct >= cfg.redPct) {
    belowOrangeSinceMs = 0;
    if (!st.barrierClosed || st.light != Light::RED || !st.siren) {
      st.barrierClosed = true;
      st.light = Light::RED;
      st.siren = true;
      if (!st.localSafety) Serial.printf("[SECURITE] niveau %.0f %% : fermeture autonome\n", pct);
      st.localSafety = true;
      changed = true;
    }
  } else if (st.localSafety) {
    if (pct < cfg.orangePct) {
      if (belowOrangeSinceMs == 0) belowOrangeSinceMs = millis();
      else if (millis() - belowOrangeSinceMs >= cfg.reopenDelaySec * 1000UL) {
        st.localSafety = false;
        st.barrierClosed = false;
        st.siren = false;
        st.light = pct < cfg.yellowPct ? Light::GREEN : Light::ORANGE;
        Serial.println("[SECURITE] retour sous le seuil orange : réouverture");
        changed = true;
      }
    } else {
      belowOrangeSinceMs = 0;
    }
  }
  if (changed) {
    applyOutputs();
    publishState();
  }
}

// ----------------------------------------------------------------------------- MQTT
void sendAck(const char *id, bool ok, const char *detail) {
  JsonDocument doc;
  doc["id"] = id;
  doc["ok"] = ok;
  if (detail) doc["detail"] = detail;
  char buf[256];
  size_t n = serializeJson(doc, buf);
  mqtt.publish(tAck.c_str(), (const uint8_t *)buf, n, false);
}

void handleCommand(JsonDocument &doc) {
  const char *id = doc["id"] | "";
  String actuator = doc["actuator"] | "";
  String value = doc["value"] | "";
  value.toUpperCase();
  const char *err = nullptr;
  if (actuator == "barrier") {
    bool close = value == "CLOSE" || value == "CLOSED";
    if (!close && levelPct() >= cfg.redPct) err = "verrouillage securite : niveau au-dessus du seuil rouge";
    else {
      st.barrierClosed = close;
      if (!close) st.localSafety = false;
    }
  } else if (actuator == "light") {
    if (value == "GREEN") st.light = Light::GREEN;
    else if (value == "ORANGE") st.light = Light::ORANGE;
    else if (value == "RED") st.light = Light::RED;
    else if (value == "OFF") st.light = Light::OFF;
    else err = "couleur inconnue";
  } else if (actuator == "siren") {
    st.siren = value == "ON" || value == "TRUE" || value == "1";
  } else if (actuator == "sampling") {
    if (value == "WATCH") st.cloudWatch = true;
    else if (value == "NORMAL") st.cloudWatch = false;
    else err = "mode inconnu";
  } else {
    err = "actionneur inconnu";
  }
  applyOutputs();
  sendAck(id, err == nullptr, err);
  publishState();
  Serial.printf("[CMD] %s=%s -> %s\n", actuator.c_str(), value.c_str(), err ? err : "OK");
}

void handleConfig(JsonDocument &doc) {
  cfg.criticalCm = doc["criticalCm"] | cfg.criticalCm;
  cfg.yellowPct = doc["yellowPct"] | cfg.yellowPct;
  cfg.orangePct = doc["orangePct"] | cfg.orangePct;
  cfg.redPct = doc["redPct"] | cfg.redPct;
  cfg.rainThreshold = doc["rainThreshold"] | cfg.rainThreshold;
  cfg.sensorHeightCm = doc["sensorHeightCm"] | cfg.sensorHeightCm;
  cfg.reopenDelaySec = doc["reopenDelaySec"] | cfg.reopenDelaySec;
  cfg.periodNormalSec = doc["periodNormalSec"] | cfg.periodNormalSec;
  cfg.periodWatchSec = doc["periodWatchSec"] | cfg.periodWatchSec;
  saveConfig();
  Serial.printf("[CONFIG] critique %.1f cm, rouge %.0f %%\n", cfg.criticalCm, cfg.redPct);
}

void onMessage(char *topic, byte *payload, unsigned int length) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, length)) return;
  if (tCmd == topic) handleCommand(doc);
  else if (tConfig == topic) handleConfig(doc);
}

void ensureWifi() {
  if (WiFi.status() == WL_CONNECTED || millis() - lastWifiTryMs < 10000) return;
  lastWifiTryMs = millis();
  Serial.println("[WIFI] connexion...");
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void ensureMqtt() {
  if (mqtt.connected() || WiFi.status() != WL_CONNECTED || millis() - lastMqttTryMs < 5000) return;
  lastMqttTryMs = millis();
  Serial.println("[MQTT] connexion...");
  if (mqtt.connect(STATION_CODE, STATION_CODE, MQTT_PASSWORD, tStatus.c_str(), 1, true, "offline")) {
    mqtt.publish(tStatus.c_str(), "online", true);
    mqtt.subscribe(tCmd.c_str(), 1);
    mqtt.subscribe(tConfig.c_str(), 1);
    publishState();
    Serial.println("[MQTT] connecté");
  } else {
    Serial.printf("[MQTT] échec rc=%d\n", mqtt.state());
  }
}

void publishTelemetry() {
  if (!mqtt.connected()) return;
  JsonDocument doc;
  if (sensorOk) doc["levelCm"] = roundf(levelCm * 100) / 100;
  else doc["levelCm"] = -1;
  doc["rain"] = roundf(rain * 100) / 100;
  doc["sensorOk"] = sensorOk;
  doc["seq"] = ++seq;
  char buf[160];
  size_t n = serializeJson(doc, buf);
  String topic = USE_GATEWAY_RAW ? String("fw/raw/") + STATION_CODE + "/telemetry" : tTelemetry;
  mqtt.publish(topic.c_str(), (const uint8_t *)buf, n, false);
}

void publishHeartbeat() {
  if (!mqtt.connected()) return;
  JsonDocument doc;
  doc["uptime"] = millis() / 1000;
  doc["rssi"] = WiFi.RSSI();
  doc["fw"] = FW_VERSION;
  doc["heap"] = ESP.getFreeHeap();
  char buf[128];
  size_t n = serializeJson(doc, buf);
  mqtt.publish(tHeartbeat.c_str(), (const uint8_t *)buf, n, false);
}

// ----------------------------------------------------------------------------- Arduino
void setup() {
  Serial.begin(115200);
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  pinMode(PIN_LED_RED, OUTPUT);
  pinMode(PIN_LED_ORANGE, OUTPUT);
  pinMode(PIN_LED_GREEN, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_STATUS_LED, OUTPUT);
  analogReadResolution(12);
  barrier.setPeriodHertz(50);
  barrier.attach(PIN_SERVO, 500, 2400);
  loadConfig();
  applyOutputs();

  String base = String("floodwatch/stations/") + STATION_CODE + "/";
  tTelemetry = base + "telemetry";
  tHeartbeat = base + "heartbeat";
  tState = base + "state";
  tStatus = base + "status";
  tAck = base + "ack";
  tCmd = base + "cmd";
  tConfig = base + "config";

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWifiTryMs = millis();
#if USE_TLS
  net.setCACert(CLOUD_CA_PEM);
#endif
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMessage);
  mqtt.setBufferSize(1024);
  mqtt.setKeepAlive(20);
  Serial.printf("FloodWatch station %s – firmware %s\n", STATION_CODE, FW_VERSION);
}

void loop() {
  ensureWifi();
  ensureMqtt();
  mqtt.loop();

  uint32_t period = (watchMode() ? cfg.periodWatchSec : cfg.periodNormalSec) * 1000UL;
  if (millis() - lastMeasureMs >= period || lastMeasureMs == 0) {
    lastMeasureMs = millis();
    bool wasWatch = watchMode();
    measure();
    localSafetyRule();          // toujours appliquée, connecté ou non
    publishTelemetry();
    if (wasWatch != watchMode()) publishState();
  }
  if (millis() - lastHeartbeatMs >= HEARTBEAT_MS) {
    lastHeartbeatMs = millis();
    publishHeartbeat();
  }
  updateSiren();
  digitalWrite(PIN_STATUS_LED, mqtt.connected() ? HIGH : (millis() / 250) % 2);
}
