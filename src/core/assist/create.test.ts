import { describe, expect, it } from 'vitest'
import type { AssetKind } from '@/core/types'
import { cleanCreatePrompt, kindFromCreateText } from './create'

describe('kindFromCreateText', () => {
  const cases: Array<[string, AssetKind, string]> = [
    // image (default)
    ['Make an image of a calm harbor at dawn', 'image', 'A calm harbor at dawn'],
    ['Design a logo for Atlas Lumen', 'image', 'Logo for Atlas Lumen'],
    ['A calm harbor at dawn, watercolor', 'image', 'Calm harbor at dawn, watercolor'],
    ['Create an Instagram post image for the launch', 'image', 'Instagram post image for the launch'],
    ['Create an image for the blog post', 'image', 'Image for the blog post'],
    ['Generate a hero image in our brand voice', 'image', 'Hero image in our brand voice'],
    // video
    ['Create a storyboard for the hero video', 'video', 'Storyboard for the hero video'],
    ['Make a 30 second video about the Lumen launch', 'video', '30 second video about the Lumen launch'],
    ['Cut a short clip from the demo', 'video', 'Cut a short clip from the demo'],
    ['Make a video of drone shots over the yard', 'video', 'Drone shots over the yard'],
    // presentation
    ['Make slides for the board meeting', 'presentation', 'Slides for the board meeting'],
    ['Build a pitch deck on Lumen pricing', 'presentation', 'Pitch deck on Lumen pricing'],
    ['Create a presentation about Q3 revenue', 'presentation', 'Q3 revenue'],
    // document
    ['Write copy for the Lumen landing page', 'document', 'Copy for the Lumen landing page'],
    ['Draft a launch email for Lumen customers', 'document', 'Launch email for Lumen customers'],
    ['Give me three headline options for Lumen', 'document', 'Three headline options for Lumen'],
    ['Write a blog post with a hero image', 'document', 'Blog post with a hero image'],
    ['Write a LinkedIn post about the beta', 'document', 'LinkedIn post about the beta'],
    ['Write a tagline in our brand voice', 'document', 'Tagline in our brand voice'],
    ['Write something short about our launch', 'document', 'Something short about our launch'],
    ['Write a script for the launch video', 'document', 'Script for the launch video'],
    // audio
    ['Record a podcast about freight trends', 'audio', 'Freight trends'],
    ['Generate a voiceover for the product video', 'audio', 'Voiceover for the product video'],
    ['Narrate the onboarding guide', 'audio', 'Onboarding guide'],
    ['Can you please create narration for the demo video?', 'audio', 'Narration for the demo video?'],
    ['Make an audio clip about the release', 'audio', 'The release'],
  ]

  it.each(cases)('%s → %s', (text, kind, prompt) => {
    const result = kindFromCreateText(text)
    expect(result.kind).toBe(kind)
    expect(result.prompt).toBe(prompt)
  })

  it('reports the cue that decided the kind, none for the image default', () => {
    expect(kindFromCreateText('Create a storyboard for the hero video').cue).toBe('storyboard')
    expect(kindFromCreateText('A calm harbor at dawn').cue).toBeUndefined()
    expect(kindFromCreateText('Write something about our launch').cue).toBe('write')
  })

  it('keeps the original text when stripping would leave nothing', () => {
    expect(cleanCreatePrompt('Make an image')).toBe('Make an image')
    expect(cleanCreatePrompt('  a  ')).toBe('A')
    expect(kindFromCreateText('')).toEqual({ kind: 'image', prompt: '' })
  })
})
