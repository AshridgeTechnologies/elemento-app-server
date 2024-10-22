import {runServer} from './server.js'
import {initializeApp} from 'firebase-admin/app'
import os from 'os'
import {CloudStorageCache} from './CloudStorageCache.js'
import {env} from 'process'
import {servicesAvailable} from './adminUtil.js'

console.log(process.env)

const portEnv = env.PORT ?? '8080'
const port = Number(portEnv)
const projectId = env.GOOGLE_CLOUD_PROJECT ?? 'NO_PROJECT_ID'

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

const allServerProps = {app: appServerProps, admin: adminServerProps, preview: previewServerProps, install: installServerProps}
runServer(port, allServerProps)
console.log('Started server on port', port, 'firebase project', projectId)
