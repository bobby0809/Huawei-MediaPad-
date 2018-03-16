import { Container } from '../src/Container';
import { expect } from 'chai';
import * as sinon from 'sinon';

function sleep(time) {
  return new Promise(resolve => {
    setTimeout(() => resolve(), time);
  });
}

describe('Container Tests', () => {
  /**
   * Clear the cached state after each run
   */
  afterEach(() => {
    Container.instances.splice(0, Container.instances.length);
    Container.registrations.splice(0, Container.registrations.length);
  });

  describe('`constructor` tests', () => {
    const app = {} as any;
    it('Should properly capture references to created instances', () => {
      for (let i = 0; i < 20; i++) {
        new Container(app);
      }
      expect(Container.instances).to.have.length(20);
    });
    it('Should properly register any preexisting, global, registrations', () => {
      sinon.spy(Container.prototype, 'register');
      const registration = ['pre', () => ({})] as any;
      Container.registrations.push(registration);

      const inst = new Container({} as any);
      const register = inst.register as sinon.SinonSpy;
      expect(register.callCount).to.equal(1);
      expect(register.calledWith(registration[0], registration[1])).to.be.true;
    });
  });

  describe('`register` Tests', () => {
    /**
     * Casting this object ref to any so we can pass it to the container ctor. We
     * don't need a fully functional app here.
     */
    const app = {} as any;
    let inst: Container;

    beforeEach(() => {
      inst = new Container(app);
    });
    /**
     * Clear the total number of
     */
    it('Should allow you to get a service, after it has been registered', () => {
      const limit = 20;
      /**
       * Register a whole bunch of services
       */
      for (let idx = 0; idx < limit; idx++) {
        inst.register(`${idx}`, () => ({ idx }));
      }

      /**
       * Try and get each of the services
       */
      for (let i = 0; i < limit; i++) {
        expect(inst.getImmediate(i)).to.deep.equal({ idx: i });
      }
    });

    it('Should throw an error if a user attempts to register an invalid factoryFxn', () => {
      expect(() => {
        (inst as any).register('test', { hello: 'world ' });
      }).to.throw();
    });

    it('Should throw an error if a user registers a service that already exists', () => {
      inst.register('test', () => ({}));
      expect(() => {
        inst.register('test', () => ({}));
      }).to.throw();
    });
  });
  describe('`get` Tests', () => {
    /**
     * Casting this object ref to any so we can pass it to the container ctor. We
     * don't need a fully functional app here.
     */
    const app = {} as any;
    let inst: Container;

    const factory = (app, instString) => {
      const obj = { hello: 'world' };
      if (instString) {
        Object.assign(obj, { [instString]: true });
      }
      return obj;
    };

    beforeEach(() => {
      inst = new Container(app);
      inst.register('test', factory);
      expect(Container.instances).to.have.length(1);
    });
    it('Should properly get a registered service', async () => {
      const service = await inst.get('test');
      expect(service).to.deep.equal({ hello: 'world' });
    });
    it('Should properly get a service that is lazily registered', async () => {
      const pService = inst.get('async-test');
      await sleep(30);
      inst.register('async-test', factory);

      const service = await pService;
      expect(service).to.deep.equal({ hello: 'world' });
    });
    it('Should properly pass the instance string, if defined', async () => {
      const service = await inst.get('test', { instance: 'special string' });
      expect(service).to.deep.equal({
        hello: 'world',
        'special string': true
      });
    });
    it('Should only invoke the factory function once', async () => {
      const stub = sinon.stub();
      stub.returns({ sneaky: 'stub' });
      inst.register('spy', stub);

      /**
       * Call `get` a bunch of times (should only call the factory once)
       */
      for (let i = 0; i < 20; i++) {
        await inst.get('spy');
      }

      expect(stub.callCount).to.equal(1);
    });
    it('Should return the cached default instance', async () => {
      const service = await inst.get('test');
      const service2 = await inst.get('test');
      expect(service).to.equal(service2);
    });
    it('Should return the cached custom instance', async () => {
      const service = await inst.get('test', { instance: 'special string' });
      const service2 = await inst.get('test', { instance: 'special string' });
      expect(service).to.equal(service2);
    });
    it('Should throw an error if a cycle is detected', async () => {
      inst.register('a', () => {
        inst.getImmediate('b');
      });
      inst.register('b', () => {
        inst.getImmediate('a');
      });

      let error = false;
      try {
        await inst.get('a');
      } catch (err) {
        error = true;
      }
      expect(error, 'Dependency cycle was not detected').to.be.true;
    });
  });
  describe('`getImmediate` Tests', () => {
    /**
     * Casting this object ref to any so we can pass it to the container ctor. We
     * don't need a fully functional app here.
     */
    const app = {} as any;
    let inst: Container;

    const factory = (app, instString) => {
      const obj = { hello: 'world' };
      if (instString) {
        Object.assign(obj, { [instString]: true });
      }
      return obj;
    };

    beforeEach(() => {
      inst = new Container(app);
      inst.register('test', factory);
      expect(Container.instances).to.have.length(1);
    });
    it('Should properly get a registered service', () => {
      const service = inst.getImmediate('test');
      expect(service).to.deep.equal({ hello: 'world' });
    });
    it("Should throw an error if a service is requested that doesn't exist", () => {
      expect(() => {
        const service = inst.getImmediate("I don't exist");
      }).to.throw();
    });
    it("Should not throw an error if a service is requested OPTIONALLY that doesn't exist", () => {
      expect(inst.getImmediate("I don't exist", { optional: true })).to.not.be
        .ok;
    });
    it('Should properly pass the instance string, if defined', () => {
      const service = inst.getImmediate('test', { instance: 'special string' });
      expect(service).to.deep.equal({
        hello: 'world',
        'special string': true
      });
    });
    it('Should only invoke the factory function once', () => {
      const stub = sinon.stub();
      stub.returns({ sneaky: 'stub' });
      inst.register('spy', stub);

      /**
       * Call `getImmediate` a bunch of times (should only call the factory once)
       */
      for (let i = 0; i < 20; i++) {
        inst.getImmediate('spy');
      }

      expect(stub.callCount).to.equal(1);
    });
    it('Should return the cached default instance', () => {
      const service = inst.getImmediate('test');
      const service2 = inst.getImmediate('test');
      expect(service).to.equal(service2);
    });
    it('Should return the cached custom instance', () => {
      const service = inst.getImmediate('test', { instance: 'special string' });
      const service2 = inst.getImmediate('test', {
        instance: 'special string'
      });
      expect(service).to.equal(service2);
    });
    it('Should throw an error if a cycle is detected', () => {
      inst.register('a', () => {
        inst.getImmediate('b');
      });
      inst.register('b', () => {
        inst.getImmediate('a');
      });

      expect(() => {
        inst.getImmediate('a');
      }).to.throw();
    });
  });
});
