import {runServer} from './server.js'
import {initializeApp} from 'firebase-admin/app'
import os from 'os'
import {CloudStorageCache} from './CloudStorageCache.js'
import {env} from 'process'

const portEnv = env.PORT ?? '8080'
const port = Number(portEnv)
const projectId = env.GOOGLE_CLOUD_PROJECT ?? 'NO_PROJECT_ID'

initializeApp({storageBucket: `${projectId}.appspot.com`})

const localFilePath = os.tmpdir() + '/' + 'appServer'
const previewLocalFilePath = os.tmpdir() + '/' + 'previewServer'
const deployCacheRoot = 'deployCache'
const previewCacheRoot = 'previewCache'
const settingsRoot = 'settings'

const appServerProps = {localFilePath, moduleCache: new CloudStorageCache(deployCacheRoot)}
const adminServerProps = {localFilePath,
    moduleCache: new CloudStorageCache(deployCacheRoot),
    settingsStore: new CloudStorageCache(settingsRoot)}
const previewServerProps = {localFilePath: previewLocalFilePath,
    moduleCache: new CloudStorageCache(previewCacheRoot),
    settingsStore: new CloudStorageCache(settingsRoot)}

runServer(port, {app: appServerProps, admin: adminServerProps, preview: previewServerProps})
console.log('Started server on port', port)
