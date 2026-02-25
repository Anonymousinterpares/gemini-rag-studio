import { useEffect, useRef } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import { useDossierStore } from '../store/useDossierStore';

export const useMigration = () => {
    const hasRun = useRef(false);

    useEffect(() => {
        if (hasRun.current) return;
        hasRun.current = true;

        const runMigration = async () => {
            const projectStore = useProjectStore.getState();

            // If projects already exist, migration has already run.
            if (projectStore.projects.length > 0) return;

            console.log('[Migration] Starting One-Time Data Migration to Project Architecture...');

            // 1. Create Default "Trump" Project
            const defaultProjectId = projectStore.createProject("Trump");
            console.log(`[Migration] Created default project ID: ${defaultProjectId}`);

            // 2. Migrate Chat Sessions
            try {
                // In db.ts, we changed loadAllChatSessions to take a projectId, but for the migration
                // we sort of break the contract because we need to load legacy items with no projectId yet.
                // We'll write a raw IndexedDB pull here just for the migration
                const db = await new Promise<IDBDatabase>((resolve, reject) => {
                    const req = indexedDB.open('fileExplorerDB', 3);
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error);
                });

                const tx = db.transaction('chatSessions', 'readwrite');
                const store = tx.objectStore('chatSessions');
                const getReq = store.getAll();

                getReq.onsuccess = async () => {
                    const sessions = getReq.result;
                    if (sessions && sessions.length > 0) {
                        for (const session of sessions) {
                            if (!session.projectId) {
                                session.projectId = defaultProjectId;
                                store.put(session);
                            }
                        }
                        console.log(`[Migration] Migrated ${sessions.length} Chat Sessions to default project.`);
                    }
                };
            } catch (e) {
                console.warn('[Migration] Failed to migrate chat sessions.', e);
            }

            // 3. Migrate Map Data
            try {
                // Legacy map data was stored under the hardcoded key "current" in "investigationMap" store
                const db = await new Promise<IDBDatabase>((resolve, reject) => {
                    const req = indexedDB.open('fileExplorerDB', 3);
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error);
                });

                const mapTx = db.transaction('investigationMap', 'readwrite');
                const mapStore = mapTx.objectStore('investigationMap');
                const getMapReq = mapStore.get('current');

                getMapReq.onsuccess = () => {
                    const mapData = getMapReq.result;
                    if (mapData) {
                        // Resave it under the new projectId key
                        mapStore.put(mapData, defaultProjectId);
                        // Optional: mapStore.delete('current'); // keep for safety for now
                        console.log(`[Migration] Migrated legacy Investigation Map to default project.`);
                    }
                }
            } catch (e) {
                console.warn('[Migration] Failed to migrate map data.', e);
            }

            // 4. Migrate Dossiers
            try {
                const dossierStore = useDossierStore.getState();
                let dossiersNeedsUpdate = false;

                const mappedDossiers = dossierStore.dossiers.map(d => {
                    if (!d.projectId) {
                        dossiersNeedsUpdate = true;
                        return { ...d, projectId: defaultProjectId };
                    }
                    return d;
                });

                if (dossiersNeedsUpdate) {
                    useDossierStore.setState({ dossiers: mappedDossiers });
                    console.log(`[Migration] Migrated ${mappedDossiers.length} Dossiers to default project.`);
                }
            } catch (e) {
                console.warn('[Migration] Failed to migrate dossiers.', e);
            }

            // Drop user into the Project Browser to see the new feature upon successful migration
            projectStore.setActiveProject(null);
            console.log('[Migration] One-Time Data Migration Complete.');
        };

        runMigration();
    }, []);
};
