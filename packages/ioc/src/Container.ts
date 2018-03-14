import { FirebaseApp } from "@firebase/app-types";
import { Deferred } from "@firebase/util";

export type interopFactory = (app: FirebaseApp, instString?: string) => any;

/**
 * A function to memoize factory function accesses
 */
function memoizeFactory(rawFactory: interopFactory) {
  const cache = new WeakMap();
  const factory: interopFactory = (app: FirebaseApp, instString: string) => {
    if (!cache.has(app)) {
      cache.set(app, {});
    }
    const instCache = cache.get(app);

    if (!instCache[instString]) {
      const inst = rawFactory(app, instString);
      instCache[instString] = inst;
    }
    return instCache[instString];

  };
  return factory
}

const registrations: [string, interopFactory][] = [];
const instances: Container[] = [];

export class Container {
  /**
   * Static Members
   */
  static get registrations() {
    return registrations;
  }
  static get instances() {
    return instances;
  }

  private _factories = {};
  private _pendingRegistration: {
    [name: string]: Deferred<any> | null
  } = {};

  constructor(private _app: FirebaseApp) {
    instances.push(this);
    registrations.forEach(([name, factoryFxn]) => {
      this.register(name, factoryFxn);
    });
  }

  register(name: string, factoryFxn: interopFactory) {
    const memoizedFactoryFxn = memoizeFactory(factoryFxn);
    /**
     * Capture the factory for later requests
     */
    this._factories[name] = memoizedFactoryFxn;

    /**
     * Resolve any pending `get` calls
     */
    if (this._pendingRegistration[name]) {
      const service = memoizedFactoryFxn(this._app);
      this._pendingRegistration[name].resolve(service);
      this._pendingRegistration[name] = null;
    }
  }

  async get(name) {
    /**
     * If the factory has already been registered, return it
     */
    if (this._factories[name]) {
      return this._factories[name](this._app);
    }

    /**
     * If it doesn't already exist, create a new deferred to asynchronously
     * handle the resolution of the `get`
     */
    if (!this._pendingRegistration[name]) {
      this._pendingRegistration[name] = new Deferred();
    }
    

    return this._pendingRegistration[name].promise;
  }

  getImmediate(name) {
    /**
     * If the factory has already been registered, return it
     */
    if (!this._factories[name]) {
      throw new Error('not-exist');
    }
    return this._factories[name](this._app);
  }
}
