import type { Asset, AssetKind, EntityRef, ID } from '@/core/types'

/** STUB — replaced by the domain-services implementation (signature is a contract). */
export interface GenerateAssetInput {
  kind: AssetKind
  prompt: string
  title?: string
  projectId?: ID | null
  boardId?: ID | null
  params?: Record<string, unknown>
  origin?: EntityRef
}

export function generateAsset(input: GenerateAssetInput): Asset {
  void input
  throw new Error('generateAsset not implemented yet')
}
