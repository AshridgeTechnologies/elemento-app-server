import {getStorage} from 'firebase-admin/storage'
import {googleApiRequest, ModuleCache} from './util.js'

export class CloudStorageCache implements ModuleCache {
    constructor(private readonly bucketName?: string) {
    }

    downloadToFile(path: string, localFilePath: string, logError = false): Promise<boolean> {
        return this.file(path).download({destination: localFilePath})
            .then(() => true, (e: any) => {
                if (logError) console.error('downloadToFile', e)
                return false
            })
    }

    exists(path: string): Promise<boolean> {
        return this.file(path).exists().then(([result]) => result)
    }

    async etag(path: string): Promise<string | undefined> {
        const exists = await this.exists(path)
        if (!exists) return undefined
        const [response] = await this.file(path).getMetadata()
        return response.metadata?.sourceEtag
    }

    async storeWithEtag(path: string, contents: Buffer, etag: string): Promise<void> {
        const file = this.file(path)
        await file.save(contents)
        if (etag) {
            await file.setMetadata({metadata: {sourceEtag: etag}})
        }
    }

    async storeWithPermissions(path: string, contents: Buffer, accessToken: string) {
        const encodedPath = encodeURIComponent(this.cachePath(path))
        await googleApiRequest('https://storage.googleapis.com',
            `upload/storage/v1/b/${this.bucket().name}/o?uploadType=media&name=${encodedPath}`,
            accessToken, 'POST', contents)
    }

    async clear(accessToken: string, prefix: string = ''): Promise<void> {
        const [cacheFiles] = await this.bucket().getFiles({prefix: this.cachePath(prefix)})
        await Promise.all(cacheFiles.map(f => {
            const encodedPath = encodeURIComponent(f.name)
            return googleApiRequest('https://storage.googleapis.com',
                `storage/v1/b/${this.bucket().name}/o/${encodedPath}`,
                accessToken, 'DELETE')
        }))
    }

    private bucket() {
        return getStorage().bucket(this.bucketName)
    }

    private file(path: string) {
        return this.bucket().file(this.cachePath(path))
    }

    private cachePath(path: string) {
        return 'deployCache' + '/' + path.replace(/^https?:\/\//, '')
    }
}