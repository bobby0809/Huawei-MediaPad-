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

import { FirebaseApp } from "@firebase/app-types";
import { Container, interopFactory } from "./src/Container";

export const CONTAINER_KEY = Symbol('@firebase/ioc Container Key');

export function register(serviceName: string, definition: interopFactory): void {
  /**
   * Register the new service with all of the available containers
   */
  Container.instances.forEach(container => {
    container.register(serviceName, definition);
  });

  /**
   * Push the registration to the default list of registrations
   */
  Container.registrations.push([serviceName, definition]);
}

export function injector(app: FirebaseApp): Container {
  return app[CONTAINER_KEY];
}

export { Container } from './src/Container';
