import {getStorage} from 'firebase-admin/storage'

export interface ModuleCache {
    downloadToFile(path: string, localFilePath: string, logError?: boolean): Promise<boolean>
    clear(): Promise<void>
    etag(path: string): Promise<string | number | boolean | null | undefined>
    store(path: string, contents: Buffer, etag?: string): Promise<void>
    exists(path: string): Promise<boolean>
}

export class CloudStorageCache implements ModuleCache {
    constructor(private readonly cacheRoot: string, private readonly bucketName?: string) {
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

    async etag(path: string): Promise<string | number | boolean | null | undefined> {
        const exists = await this.exists(path)
        if (!exists) return undefined
        const [response] = await this.file(path).getMetadata()
        return response.metadata?.sourceEtag
    }

    async store(path: string, contents: Buffer, etag?: string): Promise<void> {
        const file = this.file(path)
        await file.save(contents)
        if (etag) {
            await file.setMetadata({metadata: {sourceEtag: etag}})
        }
    }

    async clear(): Promise<void> {
        const [cacheFiles] = await this.bucket().getFiles({prefix: this.cacheRoot + '/'})
        await Promise.all(cacheFiles.map(f => f.delete()))
    }

    private bucket() {
        return getStorage().bucket(this.bucketName)
    }

    private file(path: string) {
        return this.bucket().file(this.cachePath(path))
    }

    private cachePath(path: string) {
        return this.cacheRoot + '/' + path.replace(/^https?:\/\//, '')
    }
}