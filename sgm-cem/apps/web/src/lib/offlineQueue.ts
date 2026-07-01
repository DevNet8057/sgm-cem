const DB_NAME = 'sgm-cem-offline'
const DB_VERSION = 1
const STORE = 'offline_contributions'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = e => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'queuedAt' })
      }
    }
    req.onsuccess = e => resolve((e.target as IDBOpenDBRequest).result)
    req.onerror = () => reject(req.error)
  })
}

export interface QueuedContribution {
  queuedAt: number
  membreId: string
  rubriqueId: string
  montant: number
  modePaiement: string
  directCollection?: boolean
  mobileMoneyPhone?: string
  referencePaiement?: string
}

export async function queueContribution(data: Omit<QueuedContribution, 'queuedAt'>): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).add({ ...data, queuedAt: Date.now() })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getQueuedContributions(): Promise<QueuedContribution[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => resolve(req.result as QueuedContribution[])
    req.onerror = () => reject(req.error)
  })
}

export async function dequeueContribution(queuedAt: number): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(queuedAt)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function clearQueue(): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
