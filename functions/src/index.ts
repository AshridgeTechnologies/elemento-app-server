import os from 'os'
import * as functions from 'firebase-functions'
import {initializeApp} from 'firebase-admin/app'
import createAppServer from './appServer.js'
import createAdminServer from './adminServer.js'
import createPreviewServer from './previewServer.js'
import {CloudStorageCache} from './CloudStorageCache.js'

initializeApp()

const localFilePath = os.tmpdir() + '/' + 'appServer'
const previewLocalFilePath = os.tmpdir() + '/' + 'previewServer'
const deployCacheRoot = 'deployCache'
const previewCacheRoot = 'previewCache'
const settingsRoot = 'settings'

const theAppServer = createAppServer({localFilePath, moduleCache: new CloudStorageCache(deployCacheRoot)})
export const appServer = functions.https.onRequest(theAppServer)

const theAdminServer = createAdminServer({localFilePath, moduleCache: new CloudStorageCache(deployCacheRoot), settingsStore: new CloudStorageCache(settingsRoot)})
export const adminServer = functions.https.onRequest(theAdminServer)

const thePreviewServer = createPreviewServer({localFilePath: previewLocalFilePath, moduleCache: new CloudStorageCache(previewCacheRoot)})
export const previewServer = functions.https.onRequest(thePreviewServer)
    // properties controlled by extension.yaml

