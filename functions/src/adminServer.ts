import {expressAdminApp} from './expressUtils.js'
import path from 'path'
import {deployToHosting} from './adminUtil'


const createDeployHandler = ({localFilePath}: {localFilePath: string}) =>
    async (req: any, res: any, next: (err?: any) => void) => {
        console.log('deploy handler', req.url)
        try {
            const deployTag = new Date().toISOString().substring(0, 19)
            const deployFilesPath = path.join(localFilePath, 'deploy', deployTag)
            // await deployToHosting(deployFilesPath)
            res.end()
        } catch (err) {
            next(err)
        }
    }

export default function createAdminServer({localFilePath}: {localFilePath: string}) {
    console.log('createAdminServer', )
    const deployHandler = createDeployHandler({localFilePath})
    return expressAdminApp(deployHandler)
}
