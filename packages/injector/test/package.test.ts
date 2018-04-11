/**
 * Copyright 2018 Google Inc.
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

import * as module from '../index';
import { expect } from 'chai';

describe('@firebase/injector Tests', () => {
  /**
   * Clear the cached state after each run
   */
  afterEach(() => {
    module.Container.instances.splice(0, module.Container.instances.length);
    module.Container.registrations.splice(
      0,
      module.Container.registrations.length
    );
  });

  describe('Exports', () => {
    it('Should have all of the expected exports', () => {
      expect(module.injector, 'injector function is missing').to.be.ok;
      expect(module.register, 'register function is missing').to.be.ok;
      expect(module.Container, 'Container class is missing').to.be.ok;
      expect(module.CONTAINER_KEY, 'CONTAINER_KEY symbol is missing').to.be.ok;
    });
  });
  describe('`register` Tests', () => {
    it('Should register a service for all existing containers', () => {
      const i1 = new module.Container({} as any);
      const i2 = new module.Container({} as any);

      module.register('test', () => ({ hello: 'world' }));

      /**
       * Verify both instances have separate instances of the object
       */
      expect(i1.getImmediate('test')).to.deep.equal({ hello: 'world' });
      expect(i2.getImmediate('test')).to.deep.equal({ hello: 'world' });
    });
    it('Should register a unique instance of the service with all containers', () => {
      const i1 = new module.Container({} as any);
      const i2 = new module.Container({} as any);

      module.register('test', () => ({ hello: 'world' }));

      /**
       * Verify both instances have separate instances of the object
       */
      expect(i1.getImmediate('test')).to.not.equal(i2.getImmediate('test'));
    });
    it('Should persist the registration of a service for future containers', () => {
      const i1 = new module.Container({} as any);
      const args = ['test', () => ({ hello: 'world' })];
      (module as any).register(...(args as any));

      expect(i1.getImmediate('test')).to.deep.equal({ hello: 'world' });
      expect(module.Container.registrations).to.have.length(1);
      expect(module.Container.registrations[0]).to.deep.equal(args);

      const i2 = new module.Container({} as any);
      expect(i2.getImmediate('test')).to.deep.equal({ hello: 'world' });
    });
  });
});
