import {NextFunction} from 'express'
import {DecodedIdToken, getAuth} from 'firebase-admin/auth'
import {parseParam} from './util.js'

export type ServerAppHandler = {
    [key: string]: {func: (...args: Array<any>) => any, update: boolean, argNames: string[]}
}
export type AppFactory = (appName: string, user: DecodedIdToken | null, version: string) => Promise<ServerAppHandler>

export function parseQueryParams(req: {query: { [key: string]: string; }}): object {
    const result: {[key: string]: any} = {}
    const {query} = req
    for (const p in query) {
        if (Object.prototype.hasOwnProperty.call(query, p)) {
            result[p] = parseParam(query[p])
        }
    }
    return result
}
export function errorHandler(err: any, req: any, res: any, _next: any) {
    const {status = 500, message} = err
    console.error(message)
    res?.status(status)
    res?.send({error: {status, message}})
}

function responseError(status: number, error: string) {
    const err = new Error(error) as Error & {status: number}
    err.status = status
    return err
}

export async function getCurrentUser(req: any) {
    const authHeader = req.get('Authorization')
    const idToken = authHeader?.match(/Bearer *(.*)$/)[1]
    return idToken ? await getAuth().verifyIdToken(idToken) : null
}

export const requestHandler = (appFactory: AppFactory) => async (req: any, res: any, next: (err?: any) => void) => {
    try {
        const currentUser = await getCurrentUser(req)
        console.log('user id', currentUser?.uid)
        const match = req.path.match(/^\/(\w+)\/(\w+)\/(\w+)$/)
        if (!match) {
            next(responseError(404, 'Not Found'))
            return
        }
        const [, version, appName, functionName] = match
        const handlerApp = await appFactory(appName, currentUser, version)

        const {func, update, argNames} = handlerApp[functionName] ?? {}
        if (!func) {
            next(responseError(404, 'Not Found: ' + functionName))
            return
        }

        if (update && req.method !== 'POST') {
            next(responseError(405, 'Method Not Allowed'))
            return
        }
        const params = req.method === 'GET' ? parseQueryParams(req) : req.body
        const argValues = argNames.map((n: string) => params[n])
        const result = await func(...argValues)
        res.json(result)
    } catch (err) {
        next(err)
    }
}

export function logCall(req: any, res: any, next: NextFunction) {
        console.log(req.method, req.url)
        next()
}

