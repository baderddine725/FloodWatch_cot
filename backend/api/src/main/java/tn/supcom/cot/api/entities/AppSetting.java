/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – back-end
 *  Fichier   : AppSetting.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.entities;

import jakarta.persistence.*;
import tn.supcom.cot.core.entities.RootEntity;

/** Paramètre applicatif persistant (ex. clés VAPID générées au premier démarrage). */
@Entity
@Table(name = "app_settings")
public class AppSetting implements RootEntity<String> {
    @Id
    @Column(name = "setting_key", length = 128)
    private String id;
    @Column(name = "setting_value", nullable = false, length = 2048)
    private String value;
    @Version
    private long version;

    protected AppSetting() {
    }

    public AppSetting(String key, String value) {
        this.id = key;
        this.value = value;
    }

    @Override public String getId() { return id; }
    @Override public void setId(String id) { this.id = id; }
    @Override public long getVersion() { return version; }
    @Override public void setVersion(long version) { this.version = version; }
    public String getValue() { return value; }
    public void setValue(String value) { this.value = value; }
}
