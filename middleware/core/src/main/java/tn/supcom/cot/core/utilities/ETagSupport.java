/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : core
 *  Fichier   : ETagSupport.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.core.utilities;

import java.io.Serializable;
import java.util.zip.CRC32C;

public final class ETagSupport {
    private ETagSupport(){
    }

    /**
     * Computes eTag using CRC-32C algorithm which is defined in RFC 3720
     * @param id the id of the entity or the dto
     * @param version the version of the entity or the dto
     * @return the eTag for the entity or the dto
     * @param <ID> the id type
     */
    public static <ID extends Serializable> String computeETag(ID id,long version) {
        var crc = new CRC32C();
        if (id != null) {
            var idStr = id.toString();
            for (int i = 0; i < idStr.length(); ++i) {
                crc.update(idStr.charAt(i));
            }
        }
        crc.update((byte)(version >>> 56));
        crc.update((byte)(version >>> 48));
        crc.update((byte)(version >>> 40));
        crc.update((byte)(version >>> 32));
        crc.update((byte)(version >>> 24));
        crc.update((byte)(version >>> 16));
        crc.update((byte)(version >>> 8));
        crc.update((byte)(version));
        return Long.toString(crc.getValue(),36);
    }
}
