import os from 'os'
import * as functions from 'firebase-functions'
import {initializeApp} from 'firebase-admin/app'
import {CloudStorageCache} from './util.js'
import createAppServer from './appServer.js'
import createAdminServer from './adminServer.js'
import createPreviewServer from './previewServer.js'

initializeApp()

const localFilePath = os.tmpdir() + '/' + 'appServer'
const moduleCache = new CloudStorageCache()

const theAppServer = createAppServer({localFilePath, moduleCache})
export const appServer = functions.https.onRequest(theAppServer)

const theAdminServer = createAdminServer({localFilePath, moduleCache})
export const adminServer = functions.https.onRequest(theAdminServer)

const thePreviewServer = createPreviewServer({localFilePath, moduleCache})
export const previewServer = functions.https.onRequest(thePreviewServer)
