import os from 'os'
import * as functions from 'firebase-functions'
import {defineString} from 'firebase-functions/params'
import {initializeApp} from 'firebase-admin/app'
import {CloudStorageCache} from './util.js'
import createAppServer from './appServer.js'
import createAdminServer from './adminServer.js'

initializeApp()

const localFilePath = os.tmpdir() + '/' + 'appServer'
const runtimeImportPath = defineString('X_RUNTIME_IMPORT_PATH') ?? {value: ()=> 'https://elemento.online/lib'}
const moduleCache = new CloudStorageCache()

const theAppServer = createAppServer({runtimeImportPath, localFilePath, moduleCache})

export const appServer = functions.https.onRequest(theAppServer)

const theAdminServer = createAdminServer({localFilePath, moduleCache})
export const adminServer = functions.https.onRequest(theAdminServer)
