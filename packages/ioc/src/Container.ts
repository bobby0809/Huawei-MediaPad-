import { FirebaseApp } from "@firebase/app-types";
import { Deferred } from "@firebase/util";

export type interopFactory = (app: FirebaseApp, instString?: string) => any;
export interface GetOptions {
  instance?: string
  optional?: boolean
}

const registrations: [string, interopFactory][] = [];
const instances: Container[] = [];

const DEFAULT_SERVICE_INSTANCE = '[DEFAULT]';

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

  private _instCache: {
    [serviceName: string]: {
      [instName: string]: any
    }
  } = {};
  private _factories: {
    [name: string]: interopFactory
  } = {};
  private _pendingRegistration: {
    [name: string]: Deferred<interopFactory> | null
  } = {};
  private _pendingInit = new WeakMap();

  constructor(private _app: FirebaseApp) {
    instances.push(this);
    registrations.forEach(([name, factoryFxn]) => {
      this.register(name, factoryFxn);
    });
  }

  register(name: string, factoryFxn: interopFactory) {
    /**
     * Capture the factory for later requests
     */
    this._factories[name] = factoryFxn;
    
    /**
     * Resolve any pending `get` calls
     */
    if (this._pendingRegistration[name]) {
      this._pendingRegistration[name].resolve(factoryFxn);
      this._pendingRegistration[name] = null;
    }
  }

  private _getFromCache(serviceName, options) {
    const instKey = options.instance || DEFAULT_SERVICE_INSTANCE;

    /**
     * If there is an existing service instance, return it
     */
    if (this._instCache[serviceName] && this._instCache[serviceName][instKey]) {
      return this._instCache[serviceName][instKey];
    }
  }

  async get(serviceName, options: GetOptions = {}) {
    /**
     * If the cached value exists then return it
     */
    const cachedVal = this._getFromCache(serviceName, options);
    if (cachedVal) return cachedVal;

    /**
     * The factory can either be pre-registered or lazily loaded, we handle them
     * both the same way so we will wait for the factory to be assigned to this
     * variable
     */
    const factory = await (async () => {
      if (this._factories[serviceName]) return this._factories[serviceName];
      
      /**
       * If it doesn't already exist, create a new deferred to asynchronously
       * handle the resolution of the `get`
       */
      if (!this._pendingRegistration[serviceName]) {
        this._pendingRegistration[serviceName] = new Deferred();
      }
      
      return this._pendingRegistration[serviceName].promise;
    })();

    /**
     * If the instance cache doesn't exist for the given service, create it
     */
    if (!this._instCache[serviceName]) {
      this._instCache[serviceName] = {};
    }

    const instKey = options.instance || DEFAULT_SERVICE_INSTANCE;

    /**
     * Create and cache a service instance
     */
    const inst = factory(this._app, instKey);
    this._instCache[serviceName][instKey] = inst;

    /**
     * Return the service instance
     */
    return inst;
  }

  getImmediate(serviceName, options: GetOptions = {}) {
    /**
     * If the cached value exists then return it
     */
    const cachedVal = this._getFromCache(serviceName, options);
    if (cachedVal) return cachedVal;
    
    /**
     * If the factory has not been registered, throw an error
     */
    if (!this._factories[serviceName]) {
      throw new Error('not-exist');
    }
    
    const factory = this._factories[serviceName];

    /**
     * Create and cache an instance of the factory
     */
    if (!this._instCache[name]) {
      this._instCache[name] = {};
    }

    const instKey = options.instance || DEFAULT_SERVICE_INSTANCE;    

    /**
     * Create and cache a service instance
     */
    const inst = factory(this._app, instKey);
    this._instCache[name][instKey] = inst;
    
    /**
     * Return the service instance
     */
    return inst;
  }
}
