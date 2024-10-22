import {runServer} from './server'
import {initializeApp} from 'firebase-admin/lib/app'
import os from 'os'
import {CloudStorageCache} from './CloudStorageCache'

initializeApp()

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

runServer(8080, {app: appServerProps, admin: adminServerProps, preview: previewServerProps})
