import cron from 'node-cron'; 
import Monitoring from '../src/monitoring'

const monitoring = new Monitoring();

// Validate cron schedule
export function cronValidation(expr: string) {
    if (cron.validate(expr)) {
        return expr;
    } else {
        monitoring.error('Invalid cron expression. Defaulting to Twice a day.');
        return "* */12 * * *";
    }    
}
