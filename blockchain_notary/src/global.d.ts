export {}

declare global {
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

      hashPath: (filePath: string) => Promise<{
        ok: boolean
        filePath?: string
        hashHex?: string
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
      saveCertificatePdf: (payload: {
  filePath: string
  hashHex: string
  rpcUrl: string
  author: string
  timestamp: number
  txHash: string
}) => Promise<{ ok: boolean; filePath?: string; canceled?: boolean; error?: string }>


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

      notaryNotarize: (
        hashHex: string,
        rpcUrl?: string
      ) => Promise<{
        ok: boolean
        txHash?: string
        blockNumber?: number
        error?: string
      }>
    }
  }
}
