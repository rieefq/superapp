/**
 * Generative art (track A2): deterministic procedural previews for Studio assets, plus
 * real SVG / PNG exports of exactly what the screen shows.
 */
export { ProceduralArt, parseAspect } from './ProceduralArt'
export type { ProceduralArtProps } from './ProceduralArt'
export { ArtFrame } from './ArtFrame'
export type { ArtFrameProps } from './ArtFrame'
export { exportArtSvg, exportArtPng, downloadArt } from './export'
export { ART_STYLES, normalizeStyle } from './generate'
export type { ArtStyle, ProceduralSpec } from './generate'
