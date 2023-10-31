import * as functions from 'firebase-functions'
import {defineString} from 'firebase-functions/params'
import {initializeApp} from 'firebase-admin/app'
import {CloudStorageCache} from './util.js'
import createAppServer from './appServer.js'
import os from 'os'
import createAdminServer from './adminServer'

initializeApp()

const localFilePath = os.tmpdir() + '/' + 'appServer'
const runtimeImportPath = defineString('X_RUNTIME_IMPORT_PATH') ?? {value: ()=> 'https://elemento.online/lib'}
const gitHubUserConfig = defineString('GITHUB_USER')
const gitHubRepoConfig = defineString('GITHUB_REPO')
const gitHubAccessTokenConfig = defineString('GITHUB_ACCESS_TOKEN')
const moduleCache = new CloudStorageCache()

const theAppServer = createAppServer({runtimeImportPath, localFilePath,
    gitHubUserConfig, gitHubRepoConfig, gitHubAccessTokenConfig, moduleCache})

export const appServer = functions.https.onRequest(theAppServer)

const theAdminServer = createAdminServer({localFilePath})
export const adminServer = functions.https.onRequest(theAdminServer)
