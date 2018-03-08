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

import * as firebase from 'firebase';
import * as util from '@firebase/util';
import * as request from 'request-promise';
import * as fs from 'fs';

const DBURL = 'http://localhost:9000';

class FakeCredentials {
  getAccessToken() {
    return Promise.resolve({
      expires_in: 1000000,
      access_token: 'owner'
    });
  }
  getCertificate() {
    return null;
  }
}

function fakeToken(claims: Object): String {
  let header = { alg: "RS256", kid: "fakekid" };
  return [
    util.base64.encodeString(JSON.stringify(header), false),
    util.base64.encodeString(JSON.stringify(claims), false),
    "fakesignature"
  ].join(".");
}

export function apps(): (firebase.app.App | null)[] {
  return firebase.apps;
}

export function initializeAdminApp(options: any): firebase.app.App {
  if (!('databaseName' in options)) {
    throw new Error('databaseName not specified');
  }
  return firebase.initializeApp(
    {
      databaseURL: DBURL + '?ns=' + options.databaseName
    },
    'app-' + (new Date().getTime() + Math.random())
  );
}

export function initializeTestApp(options: any): firebase.app.App {
  if (!('databaseName' in options)) {
    throw new Error('databaseName not specified');
  }
  // if options.auth is not present, we will construct an app with auth == null
  let app = firebase.initializeApp(
    {
      databaseURL: DBURL + '?ns=' + options.databaseName
    },
    'app-' + (new Date().getTime() + Math.random())
  );

  let token = fakeToken({ sub: "alice", iat: 12345 });
  (app as any).INTERNAL.getToken = function() {
    console.log("[RPB] internal getAccessToken");
    return Promise.resolve({ accessToken: token });
  };

  return app;
}

export function loadDatabaseRules(options: any): void {
  if (!('databaseName' in options)) {
    throw new Error('databaseName not specified');
  }
  if (!('rulesPath' in options)) {
    throw new Error('rulesPath not specified');
  }
  if (!fs.existsSync(options.rulesPath)) { throw new Error('Could not find file: ' + options.rulesPath);
  }
  fs
    .createReadStream(options.rulesPath)
    .pipe(
      request({
        uri: DBURL + '/.settings/rules.json?ns=' + options.databaseName,
        method: 'PUT',
        headers: { Authorization: 'Bearer owner' }
      })
    )
    .catch(function(err) {
      throw new Error('could not load rules: ' + err);
    });
}

export function assertFails(pr: Promise<any>): any {
  return pr.then(
    v =>
      Promise.reject(new Error('Expected request to fail, but it succeeded.')),
    err => err
  );
}

export function assertSucceeds(pr: Promise<any>): any {
  return pr;
}
