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

import { expect } from 'chai';
import {
  immediatePredecessor,
  immediateSuccessor, truncatedStringLength,
} from '../../../src/util/misc';

describe('immediatePredecessor', () => {
  it('generates the correct immediate predecessor', () => {
    expect(immediatePredecessor('b')).to.equal('a');
    expect(immediatePredecessor('bbBB')).to.equal('bbBA');
    expect(immediatePredecessor('aaa\0')).to.equal('aaa');
    expect(immediatePredecessor('\0')).to.equal('');
    expect(immediatePredecessor('\0\0\0')).to.equal('\0\0');
    expect(immediatePredecessor('az\u00e0')).to.equal('az\u00df');
    expect(immediatePredecessor('\uffff\uffff\uffff')).to.equal(
      '\uffff\uffff\ufffe'
    );
    expect(immediatePredecessor('')).to.equal('');
  });
});

describe('immediateSuccessor', () => {
  it('generates the correct immediate successors', () => {
    expect(immediateSuccessor('hello')).to.equal('hello\0');
    expect(immediateSuccessor('')).to.equal('\0');
  });
});

type TestCase = {
  input: string,
  threshold: number
  length: number
  output: string
}
describe('truncating strings', () => {
  it('generates the right truncation index', () => {
    const testCases: Array<TestCase> = [
      {
        input: 'clé',
        threshold: 4,
        length: 3,
        output: 'clé'
      },
      {
        input: 'clé',
        threshold: 3,
        length: 3,
        output: 'clé'
      },
      {
        input: 'clément',
        threshold: 4,
        length: 3,
        output: 'clé'
      },
      {
        input: 'clément',
        threshold: 3,
        length: 3,
        output: 'clé'
      },
      {
        input: '€uro',
        threshold: 4,
        length: 2,
        output: '€u'
      },
      {
        input: '€uro',
        threshold: 3,
        length: 1,
        output: '€'
      },
      {
        input: '€uro',
        threshold: 2,
        length: 1,
        output: '€'
      },
      {
        input: '€uro',
        threshold: 1,
        length: 1,
        output: '€'
      },
      {
        input: '€uro',
        threshold: 0,
        length: 0,
        output: ''
      },
      {
        input: '\uD800\uDF48pp',
        threshold: 5,
        length: 3,
        output: '\uD800\uDF48p'
      },
      {
        input: '\uD800\uDF48pp',
        threshold: 4,
        length: 2,
        output: '\uD800\uDF48'
      },
      {
        input: '\uD800\uDF48pp',
        threshold: 3,
        length: 2,
        output: '\uD800\uDF48'
      },
      {
        input: '\uD800\uDF48pp',
        threshold: 2,
        length: 2,
        output: '\uD800\uDF48'
      },
      {
        input: '\uD800\uDF48pp',
        threshold: 1,
        length: 2,
        output: '\uD800\uDF48'
      },
      {
        input: '\uD800\uDF48pp',
        threshold: 0,
        length: 0,
        output: ''
      }
    ];
    for (const { input, threshold, length, output } of testCases) {
      const index = truncatedStringLength(threshold)(input);
      expect(index)
        .to.equal(length, 'Input: "' + input + '", threshold: ' + threshold);
      const actual = input.substr(0, index);
      expect(actual)
        .to.equal(output, 'Input: "' + input + '", index: ' + index);
    }
  });
});
