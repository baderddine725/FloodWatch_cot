/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : MqttManager.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.managers;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import jakarta.annotation.Resource;
import jakarta.ejb.ConcurrencyManagement;
import jakarta.ejb.ConcurrencyManagementType;
import jakarta.ejb.LocalBean;
import jakarta.ejb.Singleton;
import jakarta.ejb.Startup;
import jakarta.enterprise.concurrent.ManagedScheduledExecutorService;
import jakarta.inject.Inject;
import org.eclipse.paho.mqttv5.client.*;
import org.eclipse.paho.mqttv5.client.persist.MemoryPersistence;
import org.eclipse.paho.mqttv5.common.MqttException;
import org.eclipse.paho.mqttv5.common.MqttMessage;
import org.eclipse.paho.mqttv5.common.packet.MqttProperties;

import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManagerFactory;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Arrays;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Client MQTT v5 du middleware (BrokerClient) : connexion TLS au broker Cloud, abonnement
 * aux topics des stations et publication des commandes / configurations.
 *
 * <p>Corrections par rapport au code de départ :</p>
 * <ul>
 *   <li>identifiant client construit à partir de {@code clientId} (et non du client encore nul) ;</li>
 *   <li>callback enregistré <b>avant</b> la connexion (aucun message perdu) ;</li>
 *   <li>propriétés optionnelles avec valeurs par défaut (plus d'échec au déploiement) ;</li>
 *   <li>schéma d'URL {@code ssl://} (Paho ne connaît pas {@code mqtts://}) et port 8883 ;</li>
 *   <li>réabonnement à chaque reconnexion et reconnexion différée si le broker est absent au démarrage ;</li>
 *   <li>concurrence gérée par le bean : la publication n'est pas sérialisée par un verrou EJB.</li>
 * </ul>
 */
@Singleton
@Startup
@LocalBean // le bean implémente MqttCallback : la vue sans interface doit être déclarée explicitement
@ConcurrencyManagement(ConcurrencyManagementType.BEAN)
public class MqttManager implements MqttCallback {
    private static final Logger LOG = Logger.getLogger(MqttManager.class.getName());

    private final String brokerUrl = AppConfig.get("mqtt.broker.url", "tcp://localhost:1883");
    private final String clientIdPrefix = AppConfig.get("mqtt.client.id", "floodwatch-middleware");
    private final String username = AppConfig.get("mqtt.broker.username", "");
    private final String password = AppConfig.get("mqtt.broker.password", "");
    private final String trustStorePath = AppConfig.get("mqtt.broker.truststore.path", "");
    private final String trustStorePassword = AppConfig.get("mqtt.broker.truststore.password", "changeit");

    @Resource
    private ManagedScheduledExecutorService scheduler;

    @Inject
    private EventManager eventManager;

    private volatile IMqttAsyncClient mqttClient;
    private volatile MqttConnectionOptions options;
    private volatile boolean shuttingDown;

    @PostConstruct
    public void init() {
        try {
            var clientId = "%s-%s".formatted(clientIdPrefix, UUID.randomUUID().toString().substring(0, 8));
            mqttClient = new MqttAsyncClient(brokerUrl, clientId, new MemoryPersistence());
            mqttClient.setCallback(this);

            options = new MqttConnectionOptions();
            options.setCleanStart(true);
            options.setAutomaticReconnect(true);
            options.setAutomaticReconnectDelay(1, 30);
            options.setKeepAliveInterval(30);
            options.setConnectionTimeout(10);
            if (!username.isEmpty()) {
                options.setUserName(username);
                options.setPassword(password.getBytes(StandardCharsets.UTF_8));
            }
            if (brokerUrl.startsWith("ssl://") && !trustStorePath.isEmpty()) {
                options.setSocketFactory(buildTlsContext().getSocketFactory());
            }
            scheduler.execute(this::connect);
        } catch (Exception e) {
            // On ne bloque pas le déploiement : l'API REST reste disponible et l'état "mqtt" est exposé par /api/health
            LOG.log(Level.SEVERE, "MQTT client initialisation failed", e);
        }
    }

    private SSLContext buildTlsContext() throws Exception {
        var type = trustStorePath.endsWith(".p12") || trustStorePath.endsWith(".pfx") ? "PKCS12" : "JKS";
        var ks = KeyStore.getInstance(type);
        try (var fis = new FileInputStream(trustStorePath)) {
            ks.load(fis, trustStorePassword.toCharArray());
        }
        var tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        tmf.init(ks);
        var tls = SSLContext.getInstance("TLS");
        tls.init(null, tmf.getTrustManagers(), null);
        return tls;
    }

    /** Connexion initiale avec nouvel essai toutes les 5 s (la reconnexion ultérieure est assurée par Paho). */
    private void connect() {
        if (shuttingDown) return;
        try {
            mqttClient.connect(options).waitForCompletion(15_000);
            LOG.info(() -> "MQTT connected to " + brokerUrl);
        } catch (MqttException e) {
            LOG.warning(() -> "MQTT connection to " + brokerUrl + " failed (" + e.getMessage() + "), retrying in 5 s");
            scheduler.schedule(this::connect, 5, TimeUnit.SECONDS);
        }
    }

    @PreDestroy
    public void cleanUp() {
        shuttingDown = true;
        if (mqttClient != null) {
            try {
                if (mqttClient.isConnected()) mqttClient.disconnect().waitForCompletion(2000);
                mqttClient.close();
            } catch (MqttException ignore) {
                // arrêt du serveur : rien à faire
            }
        }
    }

    /** @return vrai si le client est connecté au broker */
    public boolean isConnected() {
        return mqttClient != null && mqttClient.isConnected();
    }

    /** @return l'URL du broker configurée */
    public String brokerUrl() {
        return brokerUrl;
    }

    /**
     * Publie un message.
     *
     * @return vrai si le message a été remis au client MQTT (connecté)
     */
    public boolean publish(String topic, byte[] payload, int qos, boolean retained) {
        if (!isConnected()) {
            LOG.warning(() -> "MQTT not connected, cannot publish to " + topic);
            return false;
        }
        try {
            var msg = new MqttMessage(payload, qos, retained, null);
            mqttClient.publish(topic, msg);
            return true;
        } catch (MqttException e) {
            LOG.log(Level.WARNING, "MQTT publish to " + topic + " failed", e);
            return false;
        }
    }

    @Override
    public void connectComplete(boolean reconnect, String serverURI) {
        try {
            int[] qos = new int[Topics.SUBSCRIPTIONS.length];
            Arrays.fill(qos, 1);
            mqttClient.subscribe(Topics.SUBSCRIPTIONS, qos);
            LOG.info(() -> (reconnect ? "Re-subscribed" : "Subscribed") + " to " + Arrays.toString(Topics.SUBSCRIPTIONS));
        } catch (MqttException e) {
            LOG.log(Level.SEVERE, "MQTT subscription failed", e);
        }
    }

    @Override
    public void messageArrived(String topic, MqttMessage message) {
        // Thread du client Paho : on délègue immédiatement au bus d'événements (exécuteur géré)
        eventManager.publishFromMqtt(topic, message.getPayload());
    }

    @Override
    public void disconnected(MqttDisconnectResponse disconnectResponse) {
        LOG.warning(() -> "MQTT disconnected: " + disconnectResponse);
    }

    @Override
    public void mqttErrorOccurred(MqttException exception) {
        LOG.log(Level.WARNING, "MQTT error", exception);
    }

    @Override
    public void deliveryComplete(IMqttToken token) {
        // QoS 1 : rien à faire
    }

    @Override
    public void authPacketArrived(int reasonCode, MqttProperties properties) {
        // authentification étendue MQTT 5 non utilisée
    }
}
