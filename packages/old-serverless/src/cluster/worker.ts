import { clearCache, Deployment, DeploymentLog, DeploymentResult, getIsolate, OnDeploymentLog } from '@lagon/runtime';
import { deleteDeployment, getDeployments, setDeployment } from 'src/deployments/cache';
import startServer from 'src/server';
import { IS_DEV } from 'src/constants';
import { addDeploymentResult, clearStatsCache, getCpuTime, shouldClearCache } from 'src/deployments/result';
import type { Isolate } from 'isolated-vm';
import { getDeploymentCode } from 'src/deployments';

function deploy(deployment: Deployment) {
  const { domains, deploymentId } = deployment;

  console.log(
    'Deploy',
    deploymentId,
    'to',
    `${deploymentId}.${process.env.LAGON_ROOT_DOMAIN}`,
    deployment.isCurrent ? `and ${deployment.functionName}.${process.env.LAGON_ROOT_DOMAIN} ${domains.join(', ')}` : '',
  );

  if (deployment.isCurrent) {
    setDeployment(`${deployment.functionName}.${process.env.LAGON_ROOT_DOMAIN}`, deployment);

    for (const domain of domains) {
      setDeployment(domain, deployment);
    }
  }

  setDeployment(`${deploymentId}.${process.env.LAGON_ROOT_DOMAIN}`, deployment);

  clearCache(deployment);
  clearStatsCache(deployment);
}

function undeploy(deployment: Deployment) {
  const { domains, deploymentId } = deployment;

  console.log(
    'Undeploy',
    deploymentId,
    'from',
    `${deploymentId}.${process.env.LAGON_ROOT_DOMAIN}`,
    deployment.isCurrent ? `and ${deployment.functionName}.${process.env.LAGON_ROOT_DOMAIN} ${domains.join(', ')}` : '',
  );

  if (deployment.isCurrent) {
    deleteDeployment(`${deployment.functionName}.${process.env.LAGON_ROOT_DOMAIN}`);

    for (const domain of domains) {
      deleteDeployment(domain);
    }
  }

  deleteDeployment(`${deploymentId}.${process.env.LAGON_ROOT_DOMAIN}`);

  clearCache(deployment);
  clearStatsCache(deployment);
}

function changeCurrentDeployment(deployment: Deployment & { previousDeploymentId: string }) {
  undeploy({
    ...deployment,
    deploymentId: deployment.previousDeploymentId,
  });

  deploy({
    ...deployment,
    deploymentId: deployment.previousDeploymentId,
    isCurrent: false,
  });

  undeploy({
    ...deployment,
    isCurrent: false,
  });

  deploy(deployment);
}

function changeDomains(deployment: Deployment & { oldDomains: string[] }) {
  console.log(
    'Domains',
    deployment.deploymentId,
    'from',
    deployment.oldDomains.join(', '),
    'to',
    deployment.domains.join(', '),
  );

  for (const domain of deployment.oldDomains) {
    deleteDeployment(domain);
  }

  for (const domain of deployment.domains) {
    setDeployment(domain, deployment);
  }
}

const logs = new Map<string, DeploymentLog[]>();

const onDeploymentLog: OnDeploymentLog = ({ deploymentId, log }) => {
  if (!logs.has(deploymentId)) {
    logs.set(deploymentId, []);
  }

  logs.get(deploymentId)?.push(log);
};

async function executeDeployment(deployment: Deployment) {
  const deploymentResult: DeploymentResult = {
    cpuTime: BigInt(0),
    receivedBytes: 0,
    sentBytes: 0,
    logs: [],
  };

  let isolateCache: Isolate | undefined = undefined;
  let errored = false;

  try {
    const runIsolate = await getIsolate({
      deployment,
      getDeploymentCode,
      onReceiveStream: () => null,
      onDeploymentLog,
    });

    const { isolate } = await runIsolate({
      input: '',
      options: {
        method: 'GET',
        headers: {},
      },
    });

    isolateCache = isolate;
  } catch (e) {
    errored = true;
  }

  if (!errored && isolateCache !== undefined) {
    deploymentResult.cpuTime = getCpuTime({ isolate: isolateCache, deployment });
  }

  deploymentResult.logs = logs.get(deployment.deploymentId) || [];

  logs.delete(deployment.deploymentId);

  addDeploymentResult({ deployment, deploymentResult });
}

export default function worker() {
  const port = Number(process.env.LAGON_PORT || 4000);
  const host = process.env.LAGON_HOST || '0.0.0.0';

  // Send a message to receive `deployments` message back
  process.send?.('ok');

  process.on('message', message => {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const { msg, data } = message;

    switch (msg) {
      case 'deployments': {
        data.forEach(deploy);
        break;
      }
      case 'deploy': {
        deploy(data);
        break;
      }
      case 'undeploy': {
        undeploy(data);
        break;
      }
      case 'current': {
        changeCurrentDeployment(data);
        break;
      }
      case 'domains': {
        changeDomains(data);
        break;
      }
      case 'clean': {
        const now = new Date();

        for (const deployment of getDeployments().values()) {
          if (shouldClearCache(deployment, now)) {
            if (IS_DEV) {
              console.log('Clear cache', deployment.deploymentId);
            }

            clearCache(deployment);
            clearStatsCache(deployment);
          }
        }
        break;
      }
      case 'cron': {
        executeDeployment(data);
        break;
      }
      default:
        break;
    }
  });

  startServer(port, host);
}
