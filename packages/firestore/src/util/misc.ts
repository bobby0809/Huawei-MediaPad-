/**
 * Copyright 2017 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { assert } from './assert';

export type EventHandler<E> = (value: E) => void;

/**
 * A union of all of the standard JS types, useful for cases where the type is
 * unknown. Unlike "any" this doesn't lose all type-safety, since the consuming
 * code must still cast to a particular type before using it.
 */
export type AnyJs = null | undefined | boolean | number | string | object;

// TODO(b/66916745): AnyDuringMigration was used to suppress type check failures
// that were found during the upgrade to TypeScript 2.4. They need to be audited
// and fixed.
// tslint:disable-next-line:no-any
export type AnyDuringMigration = any;

// tslint:disable-next-line:class-as-namespace
export class AutoId {
  static newId(): string {
    // Alphanumeric characters
    const chars =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let autoId = '';
    for (let i = 0; i < 20; i++) {
      autoId += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    assert(autoId.length === 20, 'Invalid auto ID: ' + autoId);
    return autoId;
  }
}

export const IndexTruncationThresholdBytes = 1500;

export const truncatedStringComparator = (limit: number) => (
  left: string,
  right: string
): number => {
  const l = left.substr(0, limit);
  const r = right.substr(0, limit);
  if (l < r) return -1;
  if (r < l) return 1;
  // Truncated strings sort higher than equivalent, non-truncated strings.
  // e.g. w/ limit == 2, 'abc' sorts higher than 'ab', even though truncation
  // means comparing 'ab' to 'ab'. 'abc' and 'abd' would compare as equal.
  if (left.length > limit) {
    if (right.length > limit) {
      return 0;
    }
    return 1;
  } else if (right.length > limit) {
    return -1;
  }
  return 0;
};

const MIN_HIGH_SURROGATE = 0xd800;
const MAX_HIGH_SURROGATE = 0xdbff;
const isHighSurrogate = (c: number): boolean => {
  return c >= MIN_HIGH_SURROGATE && c <= MAX_HIGH_SURROGATE;
};

export const truncatedStringLength = (threshold: number) => (
  s: string
): number => {
  // count is the number of UTF-8 bytes required to represent the characters
  // up to index `i` in `s`.
  let count = 0;
  let i;
  // As soon as we cross the threshold, `i`, will be the index of the first
  // character not to be included in the truncated value. This has a max value
  // of `s.length`.
  for (i = 0; i < s.length && count < threshold; ++i) {
    const c = s.charCodeAt(i);
    if (c <= 0x7f) {
      count += 1;
    } else if (c <= 0x7ff) {
      count += 2;
    } else if (isHighSurrogate(c)) {
      // This code point is actually two UTF-16 characters, so we can skip
      // examining the next character in the string.
      ++i;
      count += 4;
    } else {
      // one character in UTF-16, but would be 3 UTF-8.
      count += 3;
    }
  }
  return i;
};

//export const indexStringComparator =
//  truncatedStringComparator(IndexTruncationThresholdBytes);

export function primitiveComparator<T>(left: T, right: T): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Duck-typed interface for objects that have an equals() method. */
export interface Equatable<T> {
  equals(other: T): boolean;
}

/** Helper to compare nullable (or undefined-able) objects using equals(). */
export function equals<T>(
  left: Equatable<T> | null | undefined,
  right: T | null | undefined
): boolean {
  if (left !== null && left !== undefined) {
    return !!(right && left.equals(right));
  } else {
    // HACK: Explicitly cast since TypeScript's type narrowing apparently isn't
    // smart enough.
    return (left as null | undefined) === right;
  }
}

/** Helper to compare arrays using equals(). */
export function arrayEquals<T>(left: Array<Equatable<T>>, right: T[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let i = 0; i < left.length; i++) {
    if (!left[i].equals(right[i])) {
      return false;
    }
  }

  return true;
}

/**
 * Returns the largest lexicographically smaller string of equal or smaller
 * length. Returns an empty string if there is no such predecessor (if the input
 * is empty).
 *
 * Strings returned from this method can be invalid UTF-16 but this is sufficent
 * in use for indexeddb because that depends on lexicographical ordering but
 * shouldn't be used elsewhere.
 */
export function immediatePredecessor(s: string): string {
  // We can decrement the last character in the string and be done
  // unless that character is 0 (0x0000), in which case we have to erase the
  // last character.
  const lastIndex = s.length - 1;
  if (s.length === 0) {
    // Special case the empty string.
    return '';
  } else if (s.charAt(lastIndex) === '\0') {
    return s.substring(0, lastIndex);
  } else {
    return (
      s.substring(0, lastIndex) +
      String.fromCharCode(s.charCodeAt(lastIndex) - 1)
    );
  }
}

/**
 * Returns the immediate lexicographically-following string. This is useful to
 * construct an inclusive range for indexeddb iterators.
 */
export function immediateSuccessor(s: string): string {
  // Return the input string, with an additional NUL byte appended.
  return s + '\0';
}
