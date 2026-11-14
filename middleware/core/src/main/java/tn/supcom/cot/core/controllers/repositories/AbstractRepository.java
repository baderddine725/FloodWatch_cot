/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : core
 *  Fichier   : AbstractRepository.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.core.controllers.repositories;

import jakarta.persistence.EntityManager;
import jakarta.persistence.EntityNotFoundException;
import jakarta.persistence.TypedQuery;
import tn.supcom.cot.core.entities.RootEntity;

import java.io.Serializable;
import java.util.List;
import java.util.Optional;

/**
 * Dépôt JPA générique (patron Repository) partagé par tous les modules.
 * <p>Remplace les ébauches AbstractItemManager / Jakarta Data du code de départ :
 * l'accès par {@link EntityManager} fonctionne sur tout serveur Jakarta EE 11 sans
 * configuration supplémentaire.</p>
 *
 * @param <E>  type d'entité
 * @param <ID> type d'identifiant
 */
public abstract class AbstractRepository<E extends RootEntity<ID>, ID extends Serializable> {

    private final Class<E> entityClass;

    protected AbstractRepository(Class<E> entityClass) {
        this.entityClass = entityClass;
    }

    /** @return l'EntityManager du contexte de persistance courant */
    protected abstract EntityManager em();

    /** Recherche par identifiant. */
    public Optional<E> findById(ID id) {
        return Optional.ofNullable(em().find(entityClass, id));
    }

    /** Recherche par identifiant ; lève {@link EntityNotFoundException} si absent. */
    public E find(ID id) {
        return findById(id).orElseThrow(() ->
                new EntityNotFoundException(entityClass.getSimpleName() + " not found: " + id));
    }

    /** @return toutes les entités du type */
    public List<E> findAll() {
        return em().createQuery("select e from " + entityClass.getSimpleName() + " e", entityClass)
                .getResultList();
    }

    /** Insère une nouvelle entité. */
    public E persist(E entity) {
        em().persist(entity);
        return entity;
    }

    /** Fusionne une entité détachée. */
    public E merge(E entity) {
        return em().merge(entity);
    }

    /** Supprime une entité. */
    public void delete(E entity) {
        em().remove(em().contains(entity) ? entity : em().merge(entity));
    }

    /** @return le premier résultat d'une requête, s'il existe */
    protected static <T> Optional<T> first(TypedQuery<T> query) {
        List<T> list = query.setMaxResults(1).getResultList();
        return list.isEmpty() ? Optional.empty() : Optional.of(list.get(0));
    }

    /** @return le nombre d'entités du type */
    public long count() {
        return em().createQuery("select count(e) from " + entityClass.getSimpleName() + " e", Long.class)
                .getSingleResult();
    }
}
