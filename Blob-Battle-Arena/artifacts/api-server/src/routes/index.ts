import { Router, type IRouter } from "express";
import healthRouter from "./health";
import lobbiesRouter from "./lobbies";

const router: IRouter = Router();

router.use(healthRouter);
router.use(lobbiesRouter);

export default router;
