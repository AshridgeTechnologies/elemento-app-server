import * as functions from 'firebase-functions'
import {defineString} from 'firebase-functions/params'
import {initializeApp} from 'firebase-admin/app'
import {CloudStorageCache} from './util.js'
import createAppServer from './appServer.js'
import os from 'os'

initializeApp()

const localFilePath = os.tmpdir() + '/' + 'appServer'
const runtimeImportPath = 'https://elemento.online/serverRuntime'
const gitHubUserConfig = defineString('GITHUB_USER')
const gitHubRepoConfig = defineString('GITHUB_REPO')
const gitHubAccessTokenConfig = defineString('GITHUB_ACCESS_TOKEN')
const moduleCache = new CloudStorageCache()

const theAppServer = createAppServer({runtimeImportPath, localFilePath,
    gitHubUserConfig, gitHubRepoConfig, gitHubAccessTokenConfig, moduleCache})

export const appServer = functions.https.onRequest(theAppServer)
