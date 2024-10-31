import {runServer} from './server.js'
import {initializeApp} from 'firebase-admin/app'
import os from 'os'
import {CloudStorageCache} from './CloudStorageCache.js'
import {env} from 'process'

console.log(process.env)

const defaultServices = 'app, admin, preview, install'
const portEnv = env.PORT ?? '8080'
const port = Number(portEnv)
const projectId = env.GOOGLE_CLOUD_PROJECT ?? 'NO_PROJECT_ID'
const servicesAvailable = (env.SERVICES_AVAILABLE ?? defaultServices).toLowerCase()

initializeApp({storageBucket: `${projectId}.appspot.com`})

const localFilePath = os.tmpdir() + '/' + 'appServer'
const previewLocalFilePath = os.tmpdir() + '/' + 'previewServer'
const deployCacheRoot = 'deployCache'
const previewCacheRoot = 'previewCache'
const settingsRoot = 'settings'

const hasService = (serviceName: string) => servicesAvailable.trim().split(/ *, */).includes(serviceName) || undefined

const appServerProps = hasService('app') && {
    localFilePath,
    moduleCache: new CloudStorageCache(deployCacheRoot)
}

const adminServerProps = hasService('admin') && {
    localFilePath,
    moduleCache: new CloudStorageCache(deployCacheRoot),
    settingsStore: new CloudStorageCache(settingsRoot),
    defaultFirebaseProject: projectId
}

const previewServerProps = hasService('preview') && {
    localFilePath: previewLocalFilePath,
    moduleCache: new CloudStorageCache(previewCacheRoot),
    settingsStore: new CloudStorageCache(settingsRoot)
}

const installServerProps = hasService('install') && {}

runServer(port, {app: appServerProps, admin: adminServerProps, preview: previewServerProps, install: installServerProps})
console.log('Started server on port', port, 'firebase project', projectId)
