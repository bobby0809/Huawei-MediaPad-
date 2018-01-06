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

import { Blob } from '../api/blob';
import { GeoPoint } from '../api/geo_point';
import { SnapshotOptions } from '../api/database';
import { DatabaseId } from '../core/database_info';
import { Timestamp } from '../core/timestamp';
import { assert, fail } from '../util/assert';
import {
  AnyJs,
  IndexTruncationThresholdBytes,
  primitiveComparator,
  truncatedStringLength,
  TruncatedStringLength
} from '../util/misc';
import * as objUtils from '../util/obj';
import { SortedMap } from '../util/sorted_map';
import * as typeUtils from '../util/types';

import { DocumentKey } from './document_key';
import { FieldPath, TruncatedPath } from './path';

/**
 * Supported data value types:
 *  - Null
 *  - Boolean
 *  - Long
 *  - Double
 *  - String
 *  - Object
 *  - Array
 *  - Binary
 *  - Timestamp
 *  - ServerTimestamp (a sentinel used in uncommitted writes)
 *  - GeoPoint
 *  - (Document) References
 */

export interface JsonObject<T> {
  [name: string]: T;
}

export enum TypeOrder {
  // This order is defined by the backend.
  NullValue = 0,
  BooleanValue = 1,
  NumberValue = 2,
  TimestampValue = 3,
  StringValue = 4,
  BlobValue = 5,
  RefValue = 6,
  GeoPointValue = 7,
  ArrayValue = 8,
  ObjectValue = 9
}

/** Defines the return value for pending server timestamps. */
export enum ServerTimestampBehavior {
  Default,
  Estimate,
  Previous
}

/** Holds properties that define field value deserialization options. */
export class FieldValueOptions {
  static readonly defaultOptions = new FieldValueOptions(
    ServerTimestampBehavior.Default
  );

  constructor(readonly serverTimestampBehavior: ServerTimestampBehavior) {}

  static fromSnapshotOptions(options: SnapshotOptions) {
    switch (options.serverTimestamps) {
      case 'estimate':
        return new FieldValueOptions(ServerTimestampBehavior.Estimate);
      case 'previous':
        return new FieldValueOptions(ServerTimestampBehavior.Previous);
      case 'none': // Fall-through intended.
      case undefined:
        return FieldValueOptions.defaultOptions;
      default:
        return fail('fromSnapshotOptions() called with invalid options.');
    }
  }
}

/**
 * Potential types returned by FieldValue.value(). This could be stricter
 * (instead of using {}), but there's little benefit.
 *
 * Note that currently we use AnyJs (which is identical except includes
 * undefined) for incoming user data as a convenience to the calling code (but
 * we'll throw if the data contains undefined). This should probably be changed
 * to use FieldType, but all consuming code will have to be updated to
 * explicitly handle undefined and then cast to FieldType or similar. Perhaps
 * we should tackle this when adding robust argument validation to the API.
 */
export type FieldType = null | boolean | number | string | {};

export type SizedComparison = {
  cmp: number;
  bytes: number; // byte size of the smaller value
};

/**
 * A field value represents a datatype as stored by Firestore.
 */
export abstract class FieldValue {
  readonly typeOrder: TypeOrder;

  // TODO: can get rid of this?
  abstract truncatedSize(bytesRemaining: number): number;
  abstract value(options?: FieldValueOptions): FieldType;
  abstract equals(other: FieldValue): boolean;
  abstract compare(other: FieldValue, bytesRemaining: number): SizedComparison;

  toString(): string {
    const val = this.value();
    return val === null ? 'null' : val.toString();
  }

  defaultCompare(other: FieldValue, bytesRemaining: number): SizedComparison {
    const cmp = this.defaultCompareTo(other);
    if (cmp <= 0) {
      return { cmp, bytes: this.truncatedSize(bytesRemaining) };
    } else {
      return { cmp, bytes: other.truncatedSize(bytesRemaining) };
    }
  }

  defaultCompareTo(other: FieldValue): number {
    assert(
      this.typeOrder !== other.typeOrder,
      'Default compareTo should not be used for values of same type.'
    );
    const cmp = primitiveComparator(this.typeOrder, other.typeOrder);
    return cmp;
  }

  compareTo(other: FieldValue): number {
    return this.compare(other, IndexTruncationThresholdBytes).cmp;
  }
}

export class NullValue extends FieldValue {
  typeOrder = TypeOrder.NullValue;

  // internalValue is unused but we add it to work around
  // https://github.com/Microsoft/TypeScript/issues/15585
  readonly internalValue = null;

  private constructor() {
    super();
  }

  value(options?: FieldValueOptions): null {
    return null;
  }

  equals(other: FieldValue): boolean {
    return other instanceof NullValue;
  }

  compare(other: FieldValue, bytesRemaining: number): SizedComparison {
    if (other instanceof NullValue) {
      return { cmp: 0, bytes: this.truncatedSize(bytesRemaining) };
    }
    return this.defaultCompare(other, bytesRemaining);
  }

  truncatedSize(bytesRemaining: number): number {
    // not truncatable.
    return 1;
  }

  static INSTANCE = new NullValue();
}

export class BooleanValue extends FieldValue {
  typeOrder = TypeOrder.BooleanValue;

  private constructor(readonly internalValue: boolean) {
    super();
  }

  value(options?: FieldValueOptions): boolean {
    return this.internalValue;
  }

  equals(other: FieldValue): boolean {
    return (
      other instanceof BooleanValue &&
      this.internalValue === other.internalValue
    );
  }

  compare(other: FieldValue, bytesRemaining: number): SizedComparison {
    if (other instanceof BooleanValue) {
      return {
        cmp: primitiveComparator(this, other),
        bytes: this.truncatedSize(bytesRemaining)
      };
    }
    return this.defaultCompare(other, bytesRemaining);
  }

  truncatedSize(bytesRemaining: number): number {
    return 1;
  }

  static of(value: boolean): BooleanValue {
    return value ? BooleanValue.TRUE : BooleanValue.FALSE;
  }

  static TRUE = new BooleanValue(true);
  static FALSE = new BooleanValue(false);
}

/** Base class for IntegerValue and DoubleValue. */
export abstract class NumberValue extends FieldValue {
  typeOrder = TypeOrder.NumberValue;

  constructor(readonly internalValue: number) {
    super();
  }

  value(options?: FieldValueOptions): number {
    return this.internalValue;
  }

  compare(other: FieldValue, bytesRemaining: number): SizedComparison {
    if (other instanceof NumberValue) {
      return {
        cmp: numericComparator(this.internalValue, other.internalValue),
        bytes: this.truncatedSize(bytesRemaining)
      };
    }
    return this.defaultCompare(other, bytesRemaining);
  }

  truncatedSize(bytesRemaining: number): number {
    return 8;
  }
}

/** Utility function to compare doubles (using Firestore semantics for NaN). */
function numericComparator(left: number, right: number): number {
  if (left < right) {
    return -1;
  } else if (left > right) {
    return 1;
  } else if (left === right) {
    return 0;
  } else {
    // one or both are NaN.
    if (isNaN(left)) {
      return isNaN(right) ? 0 : -1;
    } else {
      return 1;
    }
  }
}

/**
 * Utility function to check numbers for equality using Firestore semantics
 * (NaN === NaN, -0.0 !== 0.0).
 */
function numericEquals(left: number, right: number): boolean {
  // Implemented based on Object.is() polyfill from
  // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/is
  if (left === right) {
    // +0 != -0
    return left !== 0 || 1 / left === 1 / right;
  } else {
    // NaN == NaN
    return left !== left && right !== right;
  }
}

export class IntegerValue extends NumberValue {
  constructor(internalValue: number) {
    super(internalValue);
  }

  equals(other: FieldValue): boolean {
    // NOTE: DoubleValue and IntegerValue instances may compareTo() the same,
    // but that doesn't make them equal via equals().
    if (other instanceof IntegerValue) {
      return numericEquals(this.internalValue, other.internalValue);
    } else {
      return false;
    }
  }

  // NOTE: compareTo() is implemented in NumberValue.
}

export class DoubleValue extends NumberValue {
  constructor(readonly internalValue: number) {
    super(internalValue);
  }

  static NAN = new DoubleValue(NaN);
  static POSITIVE_INFINITY = new DoubleValue(Infinity);
  static NEGATIVE_INFINITY = new DoubleValue(-Infinity);

  equals(other: FieldValue): boolean {
    // NOTE: DoubleValue and IntegerValue instances may compareTo() the same,
    // but that doesn't make them equal via equals().
    if (other instanceof DoubleValue) {
      return numericEquals(this.internalValue, other.internalValue);
    } else {
      return false;
    }
  }

  // NOTE: compareTo() is implemented in NumberValue.
}

// Strings are allotted a 1 byte overhead on the server, so our threshold for
// truncation is the max allowed minus 1 byte.
const StringUTF8ByteThreshold = IndexTruncationThresholdBytes - 1;
const stringTruncationIndex = truncatedStringLength(StringUTF8ByteThreshold);

function stringCompare(
  bytesRemaining: number,
  left: string,
  right: string
): SizedComparison {
  // subtract one for string overhead.
  const truncationIndex = truncatedStringLength(bytesRemaining - 1);
  const leftIndex = truncationIndex(left);
  const rightIndex = truncationIndex(right);
  const cmp = primitiveComparator(
    left.substr(0, leftIndex.index),
    right.substr(0, rightIndex.index)
  );
  if (cmp === 0) {
    const leftIsTruncated = leftIndex.index < left.length;
    const rightIsTruncated = rightIndex.index < right.length;
    if (leftIsTruncated) {
      if (rightIsTruncated) {
        // Both truncated to an equal string
        return { cmp, bytes: leftIndex.bytes + 1 };
      }
      // Left was truncated, but right was not.
      return { cmp: 1, bytes: rightIndex.bytes + 1 };
    } else if (rightIsTruncated) {
      // Right was truncated, but left was not.
      return { cmp: -1, bytes: leftIndex.bytes + 1 };
    }
  }
  return { cmp, bytes: leftIndex.bytes + 1 };
}

export class StringValue extends FieldValue {
  typeOrder = TypeOrder.StringValue;
  private truncationIndex_: TruncatedStringLength;

  constructor(readonly internalValue: string) {
    super();
  }

  value(options?: FieldValueOptions): string {
    return this.internalValue;
  }

  equals(other: FieldValue): boolean {
    return (
      other instanceof StringValue && this.internalValue === other.internalValue
    );
  }

  compare(other: FieldValue, bytesRemaining: number): SizedComparison {
    if (other instanceof StringValue) {
      return stringCompare(
        bytesRemaining,
        this.internalValue,
        other.internalValue
      );
    }
    return this.defaultCompare(other, bytesRemaining);
  }

  truncatedSize(bytesRemaining: number): number {
    return truncatedStringLength(bytesRemaining)(this.internalValue).bytes;
  }

  private truncationIndex(): TruncatedStringLength {
    if (!this.truncationIndex_) {
      this.truncationIndex_ = stringTruncationIndex(this.internalValue);
    }
    return this.truncationIndex_;
  }
}

export class TimestampValue extends FieldValue {
  typeOrder = TypeOrder.TimestampValue;

  constructor(readonly internalValue: Timestamp) {
    super();
  }

  value(options?: FieldValueOptions): Date {
    return this.internalValue.toDate();
  }

  equals(other: FieldValue): boolean {
    return (
      other instanceof TimestampValue &&
      this.internalValue.equals(other.internalValue)
    );
  }

  compare(other: FieldValue, bytesRemaining: number): SizedComparison {
    if (other instanceof TimestampValue) {
      return {
        cmp: this.internalValue.compareTo(other.internalValue),
        bytes: this.truncatedSize(bytesRemaining)
      };
    } else if (other instanceof ServerTimestampValue) {
      // Concrete timestamps come before server timestamps.
      return { cmp: -1, bytes: this.truncatedSize(bytesRemaining) };
    } else {
      return this.defaultCompare(other, bytesRemaining);
    }
  }

  truncatedSize(bytesRemaining: number): number {
    return 8;
  }
}

/**
 * Represents a locally-applied ServerTimestamp.
 *
 * Notes:
 * - ServerTimestampValue instances are created as the result of applying a
 *   TransformMutation (see TransformMutation.applyTo()). They can only exist in
 *   the local view of a document. Therefore they do not need to be parsed or
 *   serialized.
 * - When evaluated locally (e.g. for snapshot.data()), they by default
 *   evaluate to `null`. This behavior can be configured by passing custom
 *   FieldValueOptions to value().
 * - With respect to other ServerTimestampValues, they sort by their
 *   localWriteTime.
 */
export class ServerTimestampValue extends FieldValue {
  typeOrder = TypeOrder.TimestampValue;

  constructor(
    readonly localWriteTime: Timestamp,
    readonly previousValue: FieldValue | null
  ) {
    super();
  }

  value(options?: FieldValueOptions): FieldType {
    if (
      options &&
      options.serverTimestampBehavior === ServerTimestampBehavior.Estimate
    ) {
      return this.localWriteTime.toDate();
    } else if (
      options &&
      options.serverTimestampBehavior === ServerTimestampBehavior.Previous
    ) {
      return this.previousValue ? this.previousValue.value(options) : null;
    } else {
      return null;
    }
  }

  equals(other: FieldValue): boolean {
    return (
      other instanceof ServerTimestampValue &&
      this.localWriteTime.equals(other.localWriteTime)
    );
  }

  compare(other: FieldValue, bytesRemaining: number): SizedComparison {
    if (other instanceof ServerTimestampValue) {
      return {
        cmp: this.localWriteTime.compareTo(other.localWriteTime),
        bytes: this.truncatedSize(bytesRemaining)
      };
    } else if (other instanceof TimestampValue) {
      // Server timestamps come after all concrete timestamps.
      return { cmp: 1, bytes: other.truncatedSize(bytesRemaining) };
    } else {
      return this.defaultCompare(other, bytesRemaining);
    }
  }

  toString(): string {
    return '<ServerTimestamp localTime=' + this.localWriteTime.toString() + '>';
  }

  truncatedSize(bytesRemaining: number): number {
    return 8;
  }
}

export class BlobValue extends FieldValue {
  typeOrder = TypeOrder.BlobValue;

  constructor(readonly internalValue: Blob) {
    super();
  }

  value(options?: FieldValueOptions): Blob {
    return this.internalValue;
  }

  equals(other: FieldValue): boolean {
    return (
      other instanceof BlobValue &&
      this.internalValue._equals(other.internalValue)
    );
  }

  compare(other: FieldValue, bytesRemaining): SizedComparison {
    if (other instanceof BlobValue) {
      const cmp = this.internalValue._compareTo(other.internalValue);
      return {
        cmp,
        bytes:
          cmp <= 0
            ? this.truncatedSize(bytesRemaining)
            : other.truncatedSize(bytesRemaining)
      };
    }
    return this.defaultCompare(other, bytesRemaining);
  }

  truncatedSize(bytesRemaining: number): number {
    return Math.min(this.internalValue.size(), bytesRemaining);
  }
}

// Datastore allocates 16 bytes for database id and project id.
export const RefTruncationLimit = IndexTruncationThresholdBytes - 16;
export class RefValue extends FieldValue {
  typeOrder = TypeOrder.RefValue;
  private truncatedPath_?: TruncatedPath = null;

  constructor(readonly databaseId: DatabaseId, readonly key: DocumentKey) {
    super();
  }

  value(options?: FieldValueOptions): DocumentKey {
    return this.key;
  }

  equals(other: FieldValue): boolean {
    if (other instanceof RefValue) {
      return (
        this.key.equals(other.key) && this.databaseId.equals(other.databaseId)
      );
    } else {
      return false;
    }
  }

  compare(other: FieldValue, bytesRemaining: number): SizedComparison {
    if (other instanceof RefValue) {
      const cmp = this.databaseId.compareTo(other.databaseId);
      if (bytesRemaining <= 16) {
        // The databaseId is untruncatable and takes up 16 bytes. So if we have
        // any bytes remaining, we take 16 bytes.
        return { cmp, bytes: 16 };
      }
      const pathRemaining = bytesRemaining - 16;
      if (cmp) {
        return {
          cmp,
          bytes:
            cmp < 0
              ? this.key.truncatedPath(pathRemaining).byteLength
              : other.key.truncatedPath(pathRemaining).byteLength
        };
      }
      const thisPath = this.key.truncatedPath(pathRemaining);
      const otherPath = other.key.truncatedPath(pathRemaining);
      const pathCmp = DocumentKey.truncatedComparator(thisPath, otherPath);
      return {
        cmp: pathCmp,
        bytes: pathCmp <= 0 ? thisPath.byteLength : otherPath.byteLength
      };
    }
    return this.defaultCompare(other, bytesRemaining);
  }

  truncatedSize(bytesRemaining: number): number {
    return 16 + this.key.truncatedPath(bytesRemaining - 16).byteLength;
  }

  private truncatedPath(): TruncatedPath {
    if (!this.truncatedPath_) {
      this.truncatedPath_ = this.key.truncatedPath(RefTruncationLimit);
    }
    return this.truncatedPath_;
  }
}

export class GeoPointValue extends FieldValue {
  typeOrder = TypeOrder.GeoPointValue;

  constructor(readonly internalValue: GeoPoint) {
    super();
  }

  value(options?: FieldValueOptions): GeoPoint {
    return this.internalValue;
  }

  equals(other: FieldValue): boolean {
    return (
      other instanceof GeoPointValue &&
      this.internalValue._equals(other.internalValue)
    );
  }

  compare(other: FieldValue, bytesRemaining: number): SizedComparison {
    if (other instanceof GeoPointValue) {
      return {
        cmp: this.internalValue._compareTo(other.internalValue),
        bytes: this.truncatedSize(bytesRemaining)
      };
    }
    return this.defaultCompare(other, bytesRemaining);
  }

  truncatedSize(bytesRemaining: number): number {
    return 16;
  }
}

export class ObjectValue extends FieldValue {
  typeOrder = TypeOrder.ObjectValue;

  constructor(readonly internalValue: SortedMap<string, FieldValue>) {
    super();
  }

  value(options?: FieldValueOptions): JsonObject<FieldType> {
    const result: JsonObject<FieldType> = {};
    this.internalValue.inorderTraversal((key, val) => {
      result[key] = val.value(options);
    });
    return result;
  }

  forEach(action: (key: string, value: FieldValue) => void): void {
    this.internalValue.inorderTraversal(action);
  }

  equals(other: FieldValue): boolean {
    if (other instanceof ObjectValue) {
      const it1 = this.internalValue.getIterator();
      const it2 = other.internalValue.getIterator();
      while (it1.hasNext() && it2.hasNext()) {
        const next1: { key: string; value: FieldValue } = it1.getNext();
        const next2: { key: string; value: FieldValue } = it2.getNext();
        if (next1.key !== next2.key || !next1.value.equals(next2.value)) {
          return false;
        }
      }

      return !it1.hasNext() && !it2.hasNext();
    }

    return false;
  }

  truncatedSize(bytesRemaining: number): number {
    let remaining = bytesRemaining;
    const it = this.internalValue.getIterator();
    while (remaining > 0 && it.hasNext()) {
      const { key, value } = it.getNext();
      remaining--; // account for string overhead
      remaining -= truncatedStringLength(remaining)(key).bytes;
      if (remaining > 0) {
        remaining -= value.truncatedSize(remaining);
      }
    }
    // remaining *may* be negative. If we hit something untruncatable,
    // we may take a few more bytes than allowed.
    return bytesRemaining - remaining;
  }

  compare(other: FieldValue, bytesRemaining: number): SizedComparison {
    if (other instanceof ObjectValue) {
      const it1 = this.internalValue.getIterator();
      const it2 = other.internalValue.getIterator();
      let remaining = bytesRemaining;
      while (it1.hasNext() && it2.hasNext() && remaining >= 0) {
        const next1: { key: string; value: FieldValue } = it1.getNext();
        const next2: { key: string; value: FieldValue } = it2.getNext();
        const keyCmp = stringCompare(remaining, next1.key, next2.key);
        // account for key bytes used
        remaining -= keyCmp.bytes;
        if (keyCmp.cmp) {
          // We have an answer, but we need the byte size.
          const lowValue = keyCmp.cmp < 0 ? next1.value : next2.value;
          remaining -= lowValue.truncatedSize(remaining);
          return {
            cmp: keyCmp.cmp,
            bytes: bytesRemaining - remaining
          };
        } else {
          const cmp = next1.value.compare(next2.value, remaining);
          // account for however much value we consumed
          remaining -= cmp.bytes;
          if (cmp.cmp) {
            // found a difference. Tally up how many bytes have been used.
            const bytes = bytesRemaining - remaining;
            return {
              cmp: cmp.cmp,
              bytes
            };
          }
        }
      }
      const bytes = bytesRemaining - remaining;
      if (it1.hasNext()) {
        return {
          cmp: 1,
          bytes
        };
      } else if (it2.hasNext()) {
        return {
          cmp: -1,
          bytes
        };
      } else {
        return {
          cmp: 0,
          bytes
        };
      }
    } else {
      return this.defaultCompare(other, bytesRemaining);
    }
  }

  set(path: FieldPath, to: FieldValue): ObjectValue {
    assert(!path.isEmpty(), 'Cannot set field for empty path on ObjectValue');
    if (path.length === 1) {
      return this.setChild(path.firstSegment(), to);
    } else {
      let child = this.child(path.firstSegment());
      if (!(child instanceof ObjectValue)) {
        child = ObjectValue.EMPTY;
      }
      const newChild = (child as ObjectValue).set(path.popFirst(), to);
      return this.setChild(path.firstSegment(), newChild);
    }
  }

  delete(path: FieldPath): ObjectValue {
    assert(
      !path.isEmpty(),
      'Cannot delete field for empty path on ObjectValue'
    );
    if (path.length === 1) {
      return new ObjectValue(this.internalValue.remove(path.firstSegment()));
    } else {
      // nested field
      const child = this.child(path.firstSegment());
      if (child instanceof ObjectValue) {
        const newChild = child.delete(path.popFirst());
        return new ObjectValue(
          this.internalValue.insert(path.firstSegment(), newChild)
        );
      } else {
        // Don't actually change a primitive value to an object for a delete
        return this;
      }
    }
  }

  contains(path: FieldPath): boolean {
    return this.field(path) !== undefined;
  }

  field(path: FieldPath): FieldValue | undefined {
    assert(!path.isEmpty(), "Can't get field of empty path");
    let field: FieldValue | undefined = this;
    path.forEach((pathSegment: string) => {
      if (field instanceof ObjectValue) {
        field = field.internalValue.get(pathSegment) || undefined;
      } else {
        field = undefined;
      }
    });
    return field;
  }

  toString(): string {
    return JSON.stringify(this.value());
  }

  private child(childName: string): FieldValue | undefined {
    return this.internalValue.get(childName) || undefined;
  }

  private setChild(childName: string, value: FieldValue): ObjectValue {
    return new ObjectValue(this.internalValue.insert(childName, value));
  }

  static EMPTY = new ObjectValue(
    new SortedMap<string, FieldValue>(primitiveComparator)
  );
}

export class ArrayValue extends FieldValue {
  typeOrder = TypeOrder.ArrayValue;

  constructor(readonly internalValue: FieldValue[]) {
    super();
  }

  value(options?: FieldValueOptions): FieldType[] {
    return this.internalValue.map(v => v.value(options));
  }

  forEach(action: (value: FieldValue) => void): void {
    this.internalValue.forEach(action);
  }

  equals(other: FieldValue): boolean {
    if (other instanceof ArrayValue) {
      if (this.internalValue.length !== other.internalValue.length) {
        return false;
      }

      for (let i = 0; i < this.internalValue.length; i++) {
        if (!this.internalValue[i].equals(other.internalValue[i])) {
          return false;
        }
      }

      return true;
    }

    return false;
  }

  truncatedSize(bytesRemaining: number): number {
    let remaining = bytesRemaining;
    for (let i = 0; i < this.internalValue.length && remaining > 0; ++i) {
      remaining -= this.internalValue[i].truncatedSize(remaining);
    }
    return bytesRemaining - remaining;
  }

  compare(other: FieldValue, bytesRemaining: number): SizedComparison {
    if (other instanceof ArrayValue) {
      const minLength = Math.min(
        this.internalValue.length,
        other.internalValue.length
      );

      let remaining = bytesRemaining;
      for (let i = 0; i < minLength && remaining > 0; i++) {
        const cmp = this.internalValue[i].compare(
          other.internalValue[i],
          remaining
        );
        if (cmp.cmp) {
          const value = cmp.cmp < 0 ? this : other;
          const cost = value.truncatedSize(bytesRemaining);
          return {
            cmp: cmp.cmp,
            bytes: cost
          };
        } else {
          remaining -= cmp.bytes;
        }
      }
      // We've exhausted one of the arrays, so this value is safe to use
      // for the size of the smaller value.
      const bytes = bytesRemaining - remaining;
      if (this.internalValue.length < other.internalValue.length) {
        return {
          cmp: -1,
          bytes
        };
      } else if (this.internalValue.length == other.internalValue.length) {
        return {
          cmp: 0,
          bytes
        };
      } else {
        return {
          cmp: 1,
          bytes
        };
      }
    } else {
      return this.defaultCompare(other, bytesRemaining);
    }
  }

  toString(): string {
    return JSON.stringify(this.value());
  }
}
