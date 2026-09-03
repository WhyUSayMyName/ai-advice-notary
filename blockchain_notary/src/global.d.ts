export {}

declare global {
  type ArtifactRecord = {
    id: number
    artifact_id: string
    display_name: string
    file_path: string
    hash: string
    version: number
    previous_hash: string | null
    created_at: number
    blockchain_tx: string | null
    notarized: number
  }

  type AuditStatus =
    | "LOCAL_ONLY"
    | "ON_CHAIN_OK"
    | "MISSING_FILE"
    | "HASH_MISMATCH"
    | "ON_CHAIN_MISSING"

  type AuditResult = {
    id: number
    artifact_id: string
    file_path: string
    stored_hash: string
    current_hash: string | null
    blockchain_tx: string | null
    notarized: number
    created_at: number
    status: AuditStatus
    author?: string
    timestamp?: number
  }

type VersionChainStatus =
  | "OK"
  | "BROKEN_LINK"
  | "MISSING_PREVIOUS_HASH"
  | "ROOT_VERSION_INVALID"

type VersionChainItem = {
  id: number
  artifact_id: string
  display_name: string
  version: number
  hash: string
  previous_hash: string | null
  status: VersionChainStatus
  details: string
}

type VersionChainReport = {
  artifact_id: string
  display_name: string
  ok: boolean
  items: VersionChainItem[]
}

type AnchorStatus = "pending" | "sent" | "confirmed" | "failed"

type AnchorQueueItem = {
  id: number
  hash: string
  rpc_url: string | null
  status: AnchorStatus
  attempts: number
  next_attempt_at: number
  tx_hash: string | null
  last_error: string | null
  created_at: number
  updated_at: number
}

type AnchorBatchSummary = {
  root: string
  tx_hash: string | null
  leaf_count: number
  created_at: number
  /** Голова цепи до эпохи; null у пакетов, созданных до появления связывания */
  prev_chain_root: string | null
  /** Голова цепи после эпохи — заякоренное on-chain значение */
  chain_root: string | null
}

/** Вердикт проверки непрерывности цепочки эпох */
type ChainVerdict =
  | { ok: true; head: string; length: number }
  | { ok: false; reason: string; brokenAt: number }

type AnchorUpdateEvent = {
  type: "queued" | "sent" | "confirmed" | "retry" | "failed" | "recovered"
  item: AnchorQueueItem
}

  interface Window {
    api: {
      // system
      ping: () => Promise<{
        ok: boolean
        message: string
        at: string
      }>

      // rpc
      connectRpc: (url: string) => Promise<{
        ok: boolean
        chainId?: number
        blockNumber?: number
        error?: string
      }>

      // files
      pickAndHash: () => Promise<{
        ok: boolean
        canceled?: boolean
        filePath?: string
        hashHex?: string
        error?: string
      }>

      inspectVersionChains: () => Promise<{
        ok: boolean
        reports?: VersionChainReport[]
        error?: string
      }>

      hashPath: (filePath: string) => Promise<{
        ok: boolean
        filePath?: string
        hashHex?: string
        error?: string
      }>

      // artifacts
      registerArtifact: (filePath: string, displayName?: string) => Promise<{
        ok: boolean
        hash?: string
        localRecord?: ArtifactRecord
        error?: string
      }>

      createArtifact: (filePath: string, displayName?: string) => Promise<{
        ok: boolean
        hash?: string
        localRecord?: ArtifactRecord
        error?: string
      }>

      createArtifactVersion: (
        artifactId: string,
        filePath: string,
        displayName?: string
      ) => Promise<{
        ok: boolean
        hash?: string
        /** true — файл не изменился с последней версии, новая версия не создавалась */
        unchanged?: boolean
        localRecord?: ArtifactRecord
        error?: string
      }>

      notarizeArtifact: (filePath: string, displayName?: string) => Promise<{
        ok: boolean
        hash?: string
        alreadyNotarized?: boolean
        /** true — фиксация поставлена в очередь anchor-сервиса */
        queued?: boolean
        queueStatus?: AnchorStatus
        txHash?: string | null
        blockNumber?: number | null
        artifact?: ArtifactRecord | null
        error?: string
      }>

      notarizeArtifactVersion: (
        artifactId: string,
        filePath: string,
        displayName?: string
      ) => Promise<{
        ok: boolean
        hash?: string
        /** true — файл не изменился с последней версии, новая версия не создавалась */
        unchanged?: boolean
        alreadyNotarized?: boolean
        /** true — фиксация поставлена в очередь anchor-сервиса */
        queued?: boolean
        queueStatus?: AnchorStatus
        txHash?: string | null
        blockNumber?: number | null
        artifact?: ArtifactRecord | null
        error?: string
      }>

      verifyArtifact: (filePath: string) => Promise<{
        ok: boolean
        hash?: string
        existsOnChain?: boolean
        author?: string
        timestamp?: number
        /** direct — одиночная фиксация, batch — через корень merkle-пакета */
        via?: "direct" | "batch" | "none"
        root?: string | null
        localRecord?: ArtifactRecord
        error?: string
      }>

      listArtifacts: () => Promise<{
        ok: boolean
        artifacts?: ArtifactRecord[]
        error?: string
      }>

      getArtifactHistory: (artifactId: string) => Promise<{
        ok: boolean
        history?: ArtifactRecord[]
        error?: string
      }>

      auditArtifacts: () => Promise<{
        ok: boolean
        results?: AuditResult[]
        error?: string
      }>

      // notary
      notaryIsNotarized: (
        hashHex: string,
        rpcUrl?: string
      ) => Promise<{
        ok: boolean
        notarized?: boolean
        error?: string
      }>

      notaryGetRecord: (
        hashHex: string,
        rpcUrl?: string
      ) => Promise<{
        ok: boolean
        exists?: boolean
        author?: string
        timestamp?: number
        error?: string
      }>

      listAnchorQueue: () => Promise<{
        ok: boolean
        queue?: AnchorQueueItem[]
        /** Момент, когда придержанный пакет уйдёт сам; null — не ждёт */
        readyAt?: number | null
        error?: string
      }>

      flushAnchorQueue: () => Promise<{
        ok: boolean
        readyAt?: number | null
        error?: string
      }>

      listAnchorBatches: () => Promise<{
        ok: boolean
        batches?: AnchorBatchSummary[]
        chain?: ChainVerdict
        error?: string
      }>

      onAnchorUpdated: (callback: (event: AnchorUpdateEvent) => void) => () => void

      exportEvidence: (rpcUrl?: string) => Promise<{
        ok: boolean
        filePath?: string
        artifacts?: number
        canceled?: boolean
        error?: string
      }>

      saveCertificatePdf: (payload: {
        filePath: string
        hashHex: string
        rpcUrl: string
        author: string
        timestamp: number
        txHash: string
      }) => Promise<{
        ok: boolean
        filePath?: string
        canceled?: boolean
        error?: string
      }>
    }
  }
}