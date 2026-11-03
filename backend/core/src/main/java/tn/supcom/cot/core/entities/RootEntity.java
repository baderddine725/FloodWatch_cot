/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : core
 *  Fichier   : RootEntity.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.core.entities;


import tn.supcom.cot.core.utilities.ETagSupport;

import java.io.Serializable;

public interface RootEntity<ID extends Serializable> extends Serializable {
    ID getId();
    void setId(ID id);
    long getVersion();
    void setVersion(long version);

    default String tag() {
        return ETagSupport.computeETag(getId(), getVersion());
    }
}
