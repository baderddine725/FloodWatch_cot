/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : WebPushSender.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.push;

import javax.crypto.Cipher;
import javax.crypto.KeyAgreement;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.io.ByteArrayOutputStream;
import java.math.BigInteger;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.interfaces.ECPrivateKey;
import java.security.interfaces.ECPublicKey;
import java.security.spec.*;
import java.time.Duration;
import java.util.Arrays;
import java.util.Base64;

/**
 * Envoi de notifications Web Push sans dépendance externe :
 * chiffrement du message (RFC 8291, encodage aes128gcm de la RFC 8188) et
 * authentification VAPID (RFC 8292, jeton JWT ES256).
 */
public class WebPushSender {
    private static final Base64.Encoder B64URL = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder B64URL_DEC = Base64.getUrlDecoder();
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final ECParameterSpec P256 = p256();

    private final ECPublicKey vapidPublic;
    private final ECPrivateKey vapidPrivate;
    private final String subject;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

    /** Paire de clés VAPID encodée en base64url (clé publique non compressée de 65 octets, privée de 32 octets). */
    public record VapidKeys(String publicKey, String privateKey) {
    }

    /** Destinataire : point de terminaison et clés fournies par {@code PushManager.subscribe()} du navigateur. */
    public record Target(String endpoint, String p256dh, String auth) {
    }

    public WebPushSender(VapidKeys keys, String subject) {
        try {
            this.vapidPublic = publicKeyFromRaw(B64URL_DEC.decode(pad(keys.publicKey())));
            this.vapidPrivate = privateKeyFromRaw(B64URL_DEC.decode(pad(keys.privateKey())));
        } catch (GeneralSecurityException e) {
            throw new IllegalArgumentException("Invalid VAPID keys", e);
        }
        this.subject = subject;
    }

    /** Génère une nouvelle paire de clés VAPID. */
    public static VapidKeys generateKeys() {
        try {
            var kpg = KeyPairGenerator.getInstance("EC");
            kpg.initialize(new ECGenParameterSpec("secp256r1"));
            var kp = kpg.generateKeyPair();
            byte[] pub = rawPublic((ECPublicKey) kp.getPublic());
            byte[] priv = unsigned32(((ECPrivateKey) kp.getPrivate()).getS());
            return new VapidKeys(B64URL.encodeToString(pub), B64URL.encodeToString(priv));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    /** @return la clé publique VAPID (applicationServerKey du navigateur) */
    public String publicKey() {
        return B64URL.encodeToString(rawPublic(vapidPublic));
    }

    /**
     * Envoie une notification.
     *
     * @return le code HTTP du service de push (201 = accepté ; 404/410 = abonnement expiré)
     */
    public int send(Target target, String payload, int ttlSeconds, String urgency) throws Exception {
        byte[] body = encrypt(payload.getBytes(StandardCharsets.UTF_8),
                B64URL_DEC.decode(pad(target.p256dh())), B64URL_DEC.decode(pad(target.auth())));
        var uri = URI.create(target.endpoint());
        String audience = uri.getScheme() + "://" + uri.getHost() + (uri.getPort() > 0 ? ":" + uri.getPort() : "");
        var request = HttpRequest.newBuilder(uri)
                .timeout(Duration.ofSeconds(15))
                .header("TTL", Integer.toString(ttlSeconds))
                .header("Urgency", urgency)
                .header("Content-Encoding", "aes128gcm")
                .header("Content-Type", "application/octet-stream")
                .header("Authorization", "vapid t=" + vapidJwt(audience) + ", k=" + publicKey())
                .POST(HttpRequest.BodyPublishers.ofByteArray(body))
                .build();
        return http.send(request, HttpResponse.BodyHandlers.discarding()).statusCode();
    }

    /** Chiffrement aes128gcm (RFC 8291 §3.4) d'un message pour un abonné. */
    public static byte[] encrypt(byte[] plaintext, byte[] uaPublic, byte[] authSecret) throws GeneralSecurityException {
        // Clé éphémère du serveur d'application
        var kpg = KeyPairGenerator.getInstance("EC");
        kpg.initialize(new ECGenParameterSpec("secp256r1"));
        var as = kpg.generateKeyPair();
        byte[] asPublic = rawPublic((ECPublicKey) as.getPublic());

        var ka = KeyAgreement.getInstance("ECDH");
        ka.init(as.getPrivate());
        ka.doPhase(publicKeyFromRaw(uaPublic), true);
        byte[] ecdhSecret = ka.generateSecret();

        byte[] prkKey = hmac(authSecret, ecdhSecret);
        byte[] keyInfo = concat("WebPush: info".getBytes(StandardCharsets.US_ASCII), new byte[]{0}, uaPublic, asPublic, new byte[]{1});
        byte[] ikm = hmac(prkKey, keyInfo);

        byte[] salt = new byte[16];
        RANDOM.nextBytes(salt);
        byte[] prk = hmac(salt, ikm);
        byte[] cek = Arrays.copyOf(hmac(prk, concat("Content-Encoding: aes128gcm".getBytes(StandardCharsets.US_ASCII), new byte[]{0, 1})), 16);
        byte[] nonce = Arrays.copyOf(hmac(prk, concat("Content-Encoding: nonce".getBytes(StandardCharsets.US_ASCII), new byte[]{0, 1})), 12);

        var cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(cek, "AES"), new GCMParameterSpec(128, nonce));
        byte[] ciphertext = cipher.doFinal(concat(plaintext, new byte[]{2})); // délimiteur du dernier enregistrement

        int rs = 4096;
        return concat(salt, ByteBuffer.allocate(4).putInt(rs).array(), new byte[]{(byte) asPublic.length}, asPublic, ciphertext);
    }

    /** Jeton VAPID : JWT ES256 {aud, exp, sub}. */
    String vapidJwt(String audience) throws GeneralSecurityException {
        String header = B64URL.encodeToString("{\"typ\":\"JWT\",\"alg\":\"ES256\"}".getBytes(StandardCharsets.UTF_8));
        long exp = System.currentTimeMillis() / 1000 + 12 * 3600;
        String claims = B64URL.encodeToString(("{\"aud\":\"" + audience + "\",\"exp\":" + exp + ",\"sub\":\"" + subject + "\"}")
                .getBytes(StandardCharsets.UTF_8));
        var sig = Signature.getInstance("SHA256withECDSAinP1363Format");
        sig.initSign(vapidPrivate);
        sig.update((header + "." + claims).getBytes(StandardCharsets.US_ASCII));
        return header + "." + claims + "." + B64URL.encodeToString(sig.sign());
    }

    // ------------------------------------------------------------------ utilitaires EC

    private static ECParameterSpec p256() {
        try {
            var params = AlgorithmParameters.getInstance("EC");
            params.init(new ECGenParameterSpec("secp256r1"));
            return params.getParameterSpec(ECParameterSpec.class);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    static ECPublicKey publicKeyFromRaw(byte[] raw) throws GeneralSecurityException {
        if (raw.length != 65 || raw[0] != 4) throw new InvalidKeyException("expected uncompressed P-256 point");
        var x = new BigInteger(1, Arrays.copyOfRange(raw, 1, 33));
        var y = new BigInteger(1, Arrays.copyOfRange(raw, 33, 65));
        return (ECPublicKey) KeyFactory.getInstance("EC").generatePublic(new ECPublicKeySpec(new ECPoint(x, y), P256));
    }

    static ECPrivateKey privateKeyFromRaw(byte[] raw) throws GeneralSecurityException {
        return (ECPrivateKey) KeyFactory.getInstance("EC").generatePrivate(new ECPrivateKeySpec(new BigInteger(1, raw), P256));
    }

    static byte[] rawPublic(ECPublicKey key) {
        return concat(new byte[]{4}, unsigned32(key.getW().getAffineX()), unsigned32(key.getW().getAffineY()));
    }

    private static byte[] unsigned32(BigInteger v) {
        byte[] b = v.toByteArray();
        if (b.length == 32) return b;
        byte[] out = new byte[32];
        if (b.length > 32) System.arraycopy(b, b.length - 32, out, 0, 32);
        else System.arraycopy(b, 0, out, 32 - b.length, b.length);
        return out;
    }

    private static byte[] hmac(byte[] key, byte[] data) throws GeneralSecurityException {
        var mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(key, "HmacSHA256"));
        return mac.doFinal(data);
    }

    private static byte[] concat(byte[]... parts) {
        var out = new ByteArrayOutputStream();
        for (byte[] p : parts) out.writeBytes(p);
        return out.toByteArray();
    }

    private static String pad(String b64url) {
        String s = b64url.trim().replace('+', '-').replace('/', '_').replace("=", "");
        return s + "=".repeat((4 - s.length() % 4) % 4);
    }
}
