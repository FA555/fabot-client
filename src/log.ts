import pino from "pino";
import pinoPretty from "pino-pretty";

const logger = pino({
    serializers: {
        error: pino.stdSerializers.err,
    },
}, pinoPretty());

export default logger;