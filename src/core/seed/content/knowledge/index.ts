import type { Collection, KnowledgeItem } from '@/core/types'
import { COLLECTION } from '../../ids'
import type { SeedCtx } from '../helpers'
import { brandKnowledge } from './brand'
import { engineeringKnowledge } from './engineering'
import { meetingKnowledge } from './meetings'
import { notesKnowledge } from './notes'
import { productKnowledge } from './product'
import { researchKnowledge } from './research'

export function buildCollections({ clock }: SeedCtx): Collection[] {
  const { day } = clock
  return [
    { id: COLLECTION.product, name: 'Product', description: 'PRDs, pricing, personas, policies and planning docs.', hue: 'sky', icon: 'Package', createdAt: day(62, 9, 0) },
    { id: COLLECTION.engineering, name: 'Engineering', description: 'ADRs, plans, handbooks and incident reports.', hue: 'cyan', icon: 'Code2', createdAt: day(62, 9, 0) },
    { id: COLLECTION.research, name: 'Research', description: 'Competitor teardowns, market sizing, interviews and win/loss notes.', hue: 'violet', icon: 'Microscope', createdAt: day(48, 9, 0) },
    { id: COLLECTION.brand, name: 'Brand', description: 'Voice, messaging and launch materials.', hue: 'amber', icon: 'Palette', createdAt: day(60, 9, 0) },
    { id: COLLECTION.meetings, name: 'Meetings', description: 'Meeting notes and call transcripts synced from Notion and the meeting recorder.', hue: 'mint', icon: 'Users', createdAt: day(45, 9, 0) },
    { id: COLLECTION.notes, name: 'Notes', description: 'Personal reading notes and learning plans.', hue: 'rose', icon: 'NotebookPen', createdAt: day(90, 9, 0) },
  ]
}

export function buildKnowledge(ctx: SeedCtx): KnowledgeItem[] {
  return [
    ...productKnowledge(ctx),
    ...engineeringKnowledge(ctx),
    ...researchKnowledge(ctx),
    ...brandKnowledge(ctx),
    ...meetingKnowledge(ctx),
    ...notesKnowledge(ctx),
  ]
}
