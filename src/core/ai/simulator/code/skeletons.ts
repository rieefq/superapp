import type { CodeLanguage } from '../shapes'

/**
 * Language-idiomatic scaffolds for requests no vetted template covers. They are honest
 * starting points: input handling and structure are real, the domain rule is a marked TODO.
 * Placeholders: ⟦NAME⟧ (language-cased identifier), ⟦CLASS⟧, ⟦DESC⟧, ⟦KEBAB⟧, ⟦TITLE⟧.
 */
export const SKELETONS: Record<CodeLanguage, string> = {
  typescript: String.raw`/**
 * ⟦DESC⟧
 */
export function ⟦NAME⟧(input: string): string[] {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (lines.length === 0) throw new Error('⟦NAME⟧: input is empty')
  return lines.map((line) => {
    // TODO: replace with the real transformation for each line.
    return line
  })
}`,
  javascript: String.raw`/**
 * ⟦DESC⟧
 * @param {string} input
 * @returns {string[]}
 */
export function ⟦NAME⟧(input) {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (lines.length === 0) throw new Error('⟦NAME⟧: input is empty')
  return lines.map((line) => {
    // TODO: replace with the real transformation for each line.
    return line
  })
}`,
  tsx: String.raw`import type { ReactNode } from 'react'

interface ⟦CLASS⟧Props {
  title: string
  children?: ReactNode
}

/** ⟦DESC⟧ */
export function ⟦CLASS⟧({ title, children }: ⟦CLASS⟧Props) {
  return (
    <section aria-labelledby="⟦KEBAB⟧-title">
      <h2 id="⟦KEBAB⟧-title">{title}</h2>
      {children ?? <p>Nothing here yet.</p>}
    </section>
  )
}`,
  jsx: String.raw`/** ⟦DESC⟧ */
export function ⟦CLASS⟧({ title, children }) {
  return (
    <section aria-labelledby="⟦KEBAB⟧-title">
      <h2 id="⟦KEBAB⟧-title">{title}</h2>
      {children ?? <p>Nothing here yet.</p>}
    </section>
  )
}`,
  python: String.raw`from typing import List


def ⟦NAME⟧(text: str) -> List[str]:
    """⟦DESC⟧"""
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        raise ValueError("⟦NAME⟧: input is empty")
    # TODO: replace with the real transformation for each line.
    return [line for line in lines]`,
  go: String.raw`package main

import (
	"errors"
	"strings"
)

// ⟦NAME⟧: ⟦DESC⟧
func ⟦NAME⟧(input string) ([]string, error) {
	var out []string
	for _, line := range strings.Split(input, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// TODO: replace with the real transformation for each line.
		out = append(out, line)
	}
	if len(out) == 0 {
		return nil, errors.New("⟦NAME⟧: input is empty")
	}
	return out, nil
}`,
  rust: String.raw`/// ⟦DESC⟧
pub fn ⟦NAME⟧(input: &str) -> Result<Vec<String>, String> {
    let lines: Vec<String> = input
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        // TODO: replace with the real transformation for each line.
        .map(str::to_string)
        .collect();
    if lines.is_empty() {
        return Err("input is empty".to_string());
    }
    Ok(lines)
}`,
  java: String.raw`import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;

public final class ⟦CLASS⟧ {
    private ⟦CLASS⟧() {}

    /** ⟦DESC⟧ */
    public static List<String> ⟦NAME⟧(String input) {
        List<String> lines = Arrays.stream(input.split("\\R"))
            .map(String::trim)
            .filter(line -> !line.isEmpty())
            // TODO: replace with the real transformation for each line.
            .collect(Collectors.toList());
        if (lines.isEmpty()) {
            throw new IllegalArgumentException("input is empty");
        }
        return lines;
    }
}`,
  kotlin: String.raw`/** ⟦DESC⟧ */
fun ⟦NAME⟧(input: String): List<String> {
    val lines = input.lines().map { it.trim() }.filter { it.isNotEmpty() }
    require(lines.isNotEmpty()) { "input is empty" }
    // TODO: replace with the real transformation for each line.
    return lines.map { it }
}`,
  swift: String.raw`import Foundation

enum ⟦CLASS⟧Error: Error {
    case emptyInput
}

/// ⟦DESC⟧
func ⟦NAME⟧(_ input: String) throws -> [String] {
    let lines = input
        .split(whereSeparator: \.isNewline)
        .map { $0.trimmingCharacters(in: .whitespaces) }
        .filter { !$0.isEmpty }
    guard !lines.isEmpty else { throw ⟦CLASS⟧Error.emptyInput }
    // TODO: replace with the real transformation for each line.
    return lines
}`,
  ruby: String.raw`# ⟦DESC⟧
def ⟦NAME⟧(input)
  lines = input.lines.map(&:strip).reject(&:empty?)
  raise ArgumentError, "input is empty" if lines.empty?

  # TODO: replace with the real transformation for each line.
  lines.map { |line| line }
end`,
  php: String.raw`<?php

declare(strict_types=1);

/**
 * ⟦DESC⟧
 *
 * @return list<string>
 */
function ⟦NAME⟧(string $input): array
{
    $parts = preg_split('/\R/', $input) ?: [];
    $lines = array_values(array_filter(array_map('trim', $parts), fn (string $line): bool => $line !== ''));
    if ($lines === []) {
        throw new InvalidArgumentException('input is empty');
    }
    // TODO: replace with the real transformation for each line.
    return $lines;
}`,
  csharp: String.raw`using System;
using System.Collections.Generic;
using System.Linq;

public static class ⟦CLASS⟧
{
    /// <summary>⟦DESC⟧</summary>
    public static IReadOnlyList<string> ⟦NAME⟧(string input)
    {
        var lines = input
            .Split('\n')
            .Select(line => line.Trim())
            .Where(line => line.Length > 0)
            .ToList();
        if (lines.Count == 0)
        {
            throw new ArgumentException("Input is empty.", nameof(input));
        }
        // TODO: replace with the real transformation for each line.
        return lines;
    }
}`,
  sql: '',
  bash: '',
  css: String.raw`/* ⟦DESC⟧ */
.⟦KEBAB⟧ {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
  border: 1px solid #d4d4d8;
  border-radius: 0.5rem;
}

.⟦KEBAB⟧__title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
}

@media (min-width: 640px) {
  .⟦KEBAB⟧ {
    flex-direction: row;
    align-items: center;
  }
}`,
  html: String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>⟦TITLE⟧</title>
  </head>
  <body>
    <main>
      <h1>⟦TITLE⟧</h1>
      <p>⟦DESC⟧</p>
    </main>
  </body>
</html>`,
}
