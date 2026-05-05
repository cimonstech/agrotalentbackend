import { Router } from 'express'
import usersRouter from './admin-users.js'
import communicationsRouter from './admin-communications.js'
import jobsRouter from './admin-jobs.js'
import applicationsRouter from './admin-applications.js'
import placementsRouter from './admin-placements.js'
import reportsRouter from './admin-reports.js'
import trainingRouter from './admin-training.js'
import settingsRouter from './admin-settings.js'
import documentsRouter from './admin-documents.js'

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

