/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : ThingDescriptions.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.boundaries;

import jakarta.json.Json;
import jakarta.json.JsonArrayBuilder;
import jakarta.json.JsonObject;
import jakarta.json.JsonObjectBuilder;
import tn.supcom.cot.api.controllers.managers.AppConfig;
import tn.supcom.cot.api.controllers.managers.Topics;
import tn.supcom.cot.api.entities.Station;

/**
 * Construction de la Thing Description W3C WoT 1.1 d'une station : propriétés observables
 * (REST + MQTT), actions (commande des actionneurs) et événements (alertes via WebSocket).
 */
public final class ThingDescriptions {
    private ThingDescriptions() {
    }

    public static JsonObject of(Station s, String apiBase) {
        String base = apiBase.endsWith("/") ? apiBase : apiBase + "/";
        String broker = AppConfig.get("mqtt.public.url", "mqtts://floodwatch.example:8883");
        String self = base + "stations/" + s.getCode();
        String telemetry = Topics.ROOT + "/" + s.getCode() + "/telemetry";

        return Json.createObjectBuilder()
                .add("@context", Json.createArrayBuilder().add("https://www.w3.org/2022/wot/td/v1.1")
                        .add(Json.createObjectBuilder().add("mqv", "http://www.example.org/mqtt-binding#")))
                .add("id", "urn:floodwatch:station:" + s.getCode())
                .add("@type", "FloodWatchStation")
                .add("title", s.getName())
                .add("description", s.getDescription() == null ? "" : s.getDescription())
                .add("version", Json.createObjectBuilder().add("instance", "1.0"))
                .add("securityDefinitions", Json.createObjectBuilder()
                        .add("nosec_sc", Json.createObjectBuilder().add("scheme", "nosec"))
                        .add("bearer_sc", Json.createObjectBuilder().add("scheme", "bearer").add("format", "jwt")
                                .add("alg", "HS256").add("in", "header")))
                .add("security", Json.createArrayBuilder().add("nosec_sc"))
                .add("properties", Json.createObjectBuilder()
                        .add("waterLevel", property("number", "Hauteur d'eau mesurée", "cm", self, broker, telemetry))
                        .add("rain", property("number", "Intensité de pluie normalisée (0..1)", null, self, broker, telemetry))
                        .add("alertLevel", Json.createObjectBuilder(property("string", "Niveau d'alerte", null, self, null, null).build())
                                .add("enum", Json.createArrayBuilder().add("GREEN").add("YELLOW").add("ORANGE").add("RED")))
                        .add("minutesToOverflow", property("number", "Temps estimé avant débordement", "min", base + "stations/" + s.getCode() + "/prediction", null, null))
                        .add("barrier", enumProperty("État de la barrière", self, "OPEN", "CLOSED", "UNKNOWN"))
                        .add("light", enumProperty("Couleur du feu", self, "GREEN", "ORANGE", "RED", "OFF", "UNKNOWN"))
                        .add("siren", property("boolean", "Sirène active", null, self, null, null)))
                .add("actions", Json.createObjectBuilder()
                        .add("setBarrier", action("Ouvrir ou fermer la barrière", base, s, "barrier", "OPEN", "CLOSE"))
                        .add("setLight", action("Commander le feu", base, s, "light", "GREEN", "ORANGE", "RED", "OFF"))
                        .add("setSiren", action("Commander la sirène", base, s, "siren", "ON", "OFF"))
                        .add("setSampling", action("Période de mesure", base, s, "sampling", "NORMAL", "WATCH")))
                .add("events", Json.createObjectBuilder()
                        .add("alert", Json.createObjectBuilder()
                                .add("description", "Alerte levée ou résolue (niveau, station muette, capteur, sécurité locale)")
                                .add("data", Json.createObjectBuilder().add("type", "object"))
                                .add("forms", Json.createArrayBuilder().add(Json.createObjectBuilder()
                                        .add("href", base.replaceFirst("^http", "ws").replace("/api/", "/ws/live"))
                                        .add("subprotocol", "websocket").add("op", "subscribeevent")))))
                .add("links", Json.createArrayBuilder().add(Json.createObjectBuilder()
                        .add("rel", "self").add("href", self + "/td").add("type", "application/td+json")))
                .build();
    }

    private static JsonObjectBuilder property(String type, String description, String unit, String href,
                                              String broker, String topic) {
        JsonArrayBuilder forms = Json.createArrayBuilder()
                .add(Json.createObjectBuilder().add("href", href).add("contentType", "application/json")
                        .add("op", Json.createArrayBuilder().add("readproperty")));
        if (broker != null) {
            forms.add(Json.createObjectBuilder().add("href", broker).add("mqv:topic", topic)
                    .add("mqv:controlPacket", "subscribe").add("op", "observeproperty"));
        }
        var b = Json.createObjectBuilder().add("type", type).add("description", description)
                .add("readOnly", true).add("observable", broker != null).add("forms", forms);
        if (unit != null) b.add("unit", unit);
        return b;
    }

    private static JsonObjectBuilder enumProperty(String description, String href, String... values) {
        var e = Json.createArrayBuilder();
        for (String v : values) e.add(v);
        return Json.createObjectBuilder(property("string", description, null, href, null, null).build()).add("enum", e);
    }

    private static JsonObjectBuilder action(String description, String base, Station s, String actuator, String... values) {
        var e = Json.createArrayBuilder();
        for (String v : values) e.add(v);
        return Json.createObjectBuilder()
                .add("description", description)
                .add("input", Json.createObjectBuilder().add("type", "object")
                        .add("properties", Json.createObjectBuilder()
                                .add("actuator", Json.createObjectBuilder().add("const", actuator))
                                .add("value", Json.createObjectBuilder().add("type", "string").add("enum", e)))
                        .add("required", Json.createArrayBuilder().add("actuator").add("value")))
                .add("security", Json.createArrayBuilder().add("bearer_sc"))
                .add("forms", Json.createArrayBuilder().add(Json.createObjectBuilder()
                        .add("href", base + "stations/" + s.getCode() + "/commands")
                        .add("htv:methodName", "POST").add("contentType", "application/json").add("op", "invokeaction")));
    }
}
