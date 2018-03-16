import { FirebaseApp } from '@firebase/app-types';
import { Deferred } from '@firebase/util';

export type interopFactory = (app: FirebaseApp, instString?: string) => any;
export interface GetOptions {
  instance?: string;
}
export interface GetImmediateOptions extends GetOptions {
  optional?: boolean;
}

const registrations: [string, interopFactory][] = [];
const instances: Container[] = [];

const DEFAULT_SERVICE_INSTANCE = '[DEFAULT]';

export class Container {
  /**
   * Static Members
   */

  /**
   * Pre-existing registered services
   */

  static get registrations() {
    return registrations;
  }

  /**
   * An Array of all Container instances
   */
  static get instances() {
    return instances;
  }

  /**
   * A cache for all of the instances of each service that exist,
   * we will only ever create one instance of a given service+instName.
   */
  private _instCache: {
    [serviceName: string]: {
      [instName: string]: any;
    };
  } = {};

  /**
   * The factories that have been registered with the Container
   */
  private _factories: {
    [serviceName: string]: interopFactory;
  } = {};

  /**
   * Pending `get` calls waiting for the registration of a given factory
   */
  private _pendingRegistration: {
    [serviceName: string]: Deferred<interopFactory> | null;
  } = {};

  private _pendingInit: {
    [serviceName: string]: {
      [instName: string]: boolean;
    };
  } = {};

  constructor(private _app: FirebaseApp) {
    instances.push(this);
    registrations.forEach(([name, factoryFxn]) => {
      this.register(name, factoryFxn);
    });
  }

  /**
   * Call to register a given service with the Container
   *
   * @param serviceName The name of the service we are registering with the
   * Container
   * @param factoryFxn The factory function that will return an instance of the
   * service in question
   */
  register(serviceName: string, factoryFxn: interopFactory) {
    if (typeof factoryFxn !== 'function') {
      throw new Error('invalid-factory');
    }
    if (this._factories[serviceName]) {
      throw new Error('already-exists');
    }
    /**
     * Capture the factory for later requests
     */
    this._factories[serviceName] = factoryFxn;

    /**
     * Resolve any pending `get` calls
     */
    if (this._pendingRegistration[serviceName]) {
      this._pendingRegistration[serviceName].resolve(factoryFxn);
      this._pendingRegistration[serviceName] = null;
    }
  }

  /**
   * Try to get the requested service from cache
   * @param serviceName The name of the service
   * @param options The instance string of the service we are trying to get
   */
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

    const instKey = options.instance || DEFAULT_SERVICE_INSTANCE;

    /**
     * Check and see if we are in a registration cycle, if so, throw an error
     */
    if (
      this._pendingInit[serviceName] &&
      this._pendingInit[serviceName][instKey]
    ) {
      throw new Error('cycle-detected');
    }

    /**
     * Set the pending state to `true`
     */
    if (!this._pendingInit[serviceName]) {
      this._pendingInit[serviceName] = {};
    }
    this._pendingInit[serviceName][instKey] = true;

    /**
     * If the instance cache doesn't exist for the given service, create it
     */
    if (!this._instCache[serviceName]) {
      this._instCache[serviceName] = {};
    }

    /**
     * Create and cache a service instance
     */
    const inst = factory(this._app, options.instance);
    this._instCache[serviceName][instKey] = inst;

    /**
     * Unset the pending state
     */
    this._pendingInit[serviceName][instKey] = false;

    /**
     * Return the service instance
     */
    return inst;
  }

  getImmediate(serviceName, options: GetImmediateOptions = {}) {
    /**
     * If the cached value exists then return it
     */
    const cachedVal = this._getFromCache(serviceName, options);
    if (cachedVal) return cachedVal;

    /**
     * If the factory has not been registered, throw an error
     */
    if (!this._factories[serviceName]) {
      if (options.optional) {
        return null;
      } else {
        throw new Error('not-exist');
      }
    }

    const factory = this._factories[serviceName];

    const instKey = options.instance || DEFAULT_SERVICE_INSTANCE;

    /**
     * Check and see if we are in a registration cycle, if so, throw an error
     */
    if (
      this._pendingInit[serviceName] &&
      this._pendingInit[serviceName][instKey]
    ) {
      throw new Error('cycle-detected');
    }

    /**
     * Set the pending state to `true`
     */
    if (!this._pendingInit[serviceName]) {
      this._pendingInit[serviceName] = {};
    }
    this._pendingInit[serviceName][instKey] = true;

    /**
     * If the instance cache doesn't exist for the given service, create it
     */
    if (!this._instCache[serviceName]) {
      this._instCache[serviceName] = {};
    }

    /**
     * Create and cache a service instance
     */
    const inst = factory(this._app, options.instance);
    this._instCache[serviceName][instKey] = inst;

    /**
     * Unset the pending state
     */
    this._pendingInit[serviceName][instKey] = false;

    /**
     * Return the service instance
     */
    return inst;
  }
}
