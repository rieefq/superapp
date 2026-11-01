/**
 * Local search & knowledge retrieval — real BM25 full-text search running in the browser
 * (not simulated). See store.ts for indexing lifecycle and entityIndex.ts for ranking.
 */
export type { SearchResult, SearchOptions, RetrievedPassage, RetrieveOptions } from './types'
export {
  search, retrieveKnowledge, warmSearchIndex, isSearchReady, subscribeSearchIndex, getSearchIndexVersion,
  __resetSearchForTests,
} from './store'
export { useSearch, SEARCH_DEBOUNCE_MS } from './hooks'
export { highlightText, SNIPPET_LENGTH } from './snippet'
export { splitPassages, PASSAGE_TARGET_CHARS } from './retrieval'
export { DEFAULT_SEARCH_LIMIT } from './entityIndex'
