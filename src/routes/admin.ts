import { Router } from 'express'
import usersRouter from './admin-users'
import communicationsRouter from './admin-communications'
import jobsRouter from './admin-jobs'
import applicationsRouter from './admin-applications'
import placementsRouter from './admin-placements'
import reportsRouter from './admin-reports'
import trainingRouter from './admin-training'
import settingsRouter from './admin-settings'
import documentsRouter from './admin-documents'

const router = Router()

router.use('/', usersRouter)
router.use('/', communicationsRouter)
router.use('/', jobsRouter)
router.use('/', applicationsRouter)
router.use('/', placementsRouter)
router.use('/', reportsRouter)
router.use('/', trainingRouter)
router.use('/', settingsRouter)
router.use('/', documentsRouter)

export default router

