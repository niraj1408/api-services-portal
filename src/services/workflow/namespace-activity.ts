import { strict as assert } from 'assert';
import {
  ActivityQueryFilter,
  ActivitySummary,
  ConsumerPluginInput,
} from './types';
import { Logger } from '../../logger';
import { format, getActivity, recordActivity } from '../keystone/activity';
import {
  AccessRequest,
  Activity,
  ActivityWhereInput,
  Application,
  ConsumerProdEnvAccess,
  CredentialIssuer,
  Environment,
  GatewayConsumer,
  GatewayService,
  Product,
  ServiceAccess,
  User,
} from '../keystone/types';
import { parseBlobString } from '../../batch/feed-worker';

const logger = Logger('wf.Activity');
export interface ActivityDataInput {
  accessRequest?: AccessRequest;
  application?: Application;
  environment?: Environment;
  product?: Product;
  productName?: string;
  credentialIssuer?: CredentialIssuer;
  serviceAccess?: ServiceAccess;
  prodEnvAccessItem?: ConsumerProdEnvAccess;
  consumer?: GatewayConsumer;
  consumerUsername?: string;
}
export class StructuredActivityService {
  context: any;
  namespace: string;
  actor: User;

  constructor(context: any, namespace: string) {
    this.context = context;
    this.namespace = namespace;
    this.actor = this.context.authedItem;
  }

  mapDataInputToParams(
    dataInput: ActivityDataInput,
    params: { [key: string]: string }
  ) {
    Object.keys(dataInput).forEach((key) => {
      switch (key) {
        case 'accessRequest':
          params[key] = dataInput.accessRequest.id;
          break;
        case 'application':
          params[key] = dataInput.application.name;
          break;
        case 'product':
          params[key] = dataInput.product.name;
          break;
        case 'productName':
          params['product'] = dataInput.productName;
          break;
        case 'environment':
          params[key] = dataInput.environment.name;
          break;
        case 'credentialIssuer':
          params[key] = dataInput.credentialIssuer.name;
          break;
        case 'consumer':
          params[key] = dataInput.consumer.username;
          break;
        case 'consumerUsername':
          params['consumer'] = dataInput.consumerUsername;
          break;
        case 'prodEnvAccessItem':
          params['product'] = dataInput.prodEnvAccessItem.productName;
          break;
      }
    });
  }

  mapDataInputToIDs(idKeys: string[], dataInput: ActivityDataInput): string[] {
    const params: { [key: string]: string } = {};
    this.mapDataInputToParams(dataInput, params);

    return idKeys.map((key) => `${key}:${params[key]}`);
  }

  public async logApproveAccess(
    success: boolean,
    dataInput: ActivityDataInput
  ) {
    const { actor } = this;
    const message =
      '{actor} {action} {entity} for {application} ({consumer}) to access {product} {environment}';
    const params = {
      actor: actor.name,
      action: 'approved',
      entity: 'access request',
    };
    this.mapDataInputToParams(dataInput, params);

    return this.recordActivity(
      success,
      message,
      params,
      this.mapDataInputToIDs(
        ['accessRequest', 'consumer', 'environment'],
        dataInput
      )
    );
  }

  public async logRejectAccess(success: boolean, dataInput: ActivityDataInput) {
    const { actor } = this;
    const message =
      '{actor} {action} {entity} for {application} ({consumer}) to access {product} {environment}';
    const params = {
      actor: actor.name,
      action: 'rejected',
      entity: 'access request',
    };
    this.mapDataInputToParams(dataInput, params);

    return this.recordActivity(
      success,
      message,
      params,
      this.mapDataInputToIDs(
        ['accessRequest', 'consumer', 'environment'],
        dataInput
      )
    );
  }

  public async logCollectedCredentials(
    success: boolean,
    dataInput: ActivityDataInput,
    pendingApproval: boolean
  ) {
    const { actor } = this;
    const message =
      '{actor} {action} for {application} ({consumer}) to access {product} {environment} ({note})';
    const params = {
      actor: actor.name,
      action: 'received credentials',
      entity: 'access',
      note: pendingApproval ? 'access pending approval' : 'auto approved',
    };
    this.mapDataInputToParams(dataInput, params);

    return this.recordActivity(
      success,
      message,
      params,
      this.mapDataInputToIDs(
        ['accessRequest', 'consumer', 'environment'],
        dataInput
      )
    );
  }

  public async logGrantRevokeConsumerAccess(
    success: boolean,
    grant: boolean,
    dataInput: ActivityDataInput
  ) {
    const { actor } = this;
    const params = {
      actor: actor.name,
      action: grant ? 'granted' : 'revoked',
      entity: 'access',
    };
    this.mapDataInputToParams(dataInput, params);

    const ids = this.mapDataInputToIDs(['consumer'], dataInput);

    return this.recordActivity(
      success,
      grant
        ? '{actor} {action} {consumer} {entity} to {product} {environment}'
        : '{actor} {action} {entity} to {product} {environment} from {consumer}',
      params,
      ids
    );
  }

  public async logRevokeAllConsumerAccess(
    success: boolean,
    dataInput: ActivityDataInput
  ) {
    const { actor } = this;

    const params = {
      actor: actor.name,
      action: 'revoked all',
      entity: 'access',
    };
    this.mapDataInputToParams(dataInput, params);

    const ids = this.mapDataInputToIDs(['consumer'], dataInput);

    return this.recordActivity(
      success,
      '{actor} {action} {entity} from {consumer}',
      params,
      ids
    );
  }

  public async logUpdateConsumerAccess(
    success: boolean,
    dataInput: ActivityDataInput,
    accessUpdate: string
  ) {
    const { actor } = this;

    const message =
      '{actor} {action} {entity} (Product:{product} {environment}, Consumer: {consumer}) to: {accessUpdate}';
    const params = {
      actor: actor.name,
      action: 'updated',
      entity: 'ConsumerProductAccess',
      accessUpdate,
    };

    this.mapDataInputToParams(dataInput, params);

    //const ids = this.mapDataInputToIDs(['consumer'], dataInput);

    return this.recordActivity(success, message, params, [
      `ConsumerProdEnvAccess:${dataInput.consumer.id}.${dataInput.prodEnvAccessItem.environment.id}`,
      `consumer:${dataInput.consumer.username}`,
      `product:${dataInput.prodEnvAccessItem.productName}`,
    ]);
  }

  public async logCreateServiceAccount(
    success: boolean,
    permissions: string[],
    consumerUsername: string
  ) {
    const { actor } = this;
    const message =
      '{actor} {action} {entity} ({consumer}) with permissions: {permissions}';
    const params = {
      actor: actor.name,
      action: 'created',
      entity: 'namespace service account',
      permissions: permissions.join(', '),
      consumer: consumerUsername,
    };
    return this.recordActivity(success, message, params, [
      `consumer:${consumerUsername}`,
    ]);
  }

  public async logListActivity(
    success: boolean,
    operation: string,
    entity: string,
    dataInput: ActivityDataInput,
    message: string
  ) {
    const operationActionMap: { [key: string]: string } = {
      delete: 'deleted',
      create: 'created',
      update: 'updated',
    };

    const { actor } = this;
    const params = {
      actor: actor.name,
      action: operationActionMap[operation],
      entity,
    };
    this.mapDataInputToParams(dataInput, params);

    const ids = this.mapDataInputToIDs([entity], dataInput);

    return this.recordActivity(success, message, params, ids);
  }

  public async logNamespaceAccess(
    success: boolean,
    grantRevoke: 'granted' | 'revoked',
    entity: string,
    subjectType: 'user' | 'client',
    subject: string,
    scopes: string[]
  ) {
    const { actor } = this;
    const params = {
      actor: actor.name,
      action: grantRevoke,
      entity,
      subject,
      permissions: scopes.join(', '),
      subjectType,
    };
    const message = '{actor} {action} {subject} permissions: {permissions}';

    const ids = [
      subjectType == 'client' ? `serviceAccount:${subject}` : `user:${subject}`,
    ];

    return this.recordActivity(success, message, params, ids);
  }

  public async logConsumerPluginUpdate(
    success: boolean,
    dataInput: ActivityDataInput,
    pluginSummary: ConsumerPluginInput
  ) {
    const { actor } = this;
    const params = {
      actor: actor.name,
      action: pluginSummary.operation,
      entity: 'consumer control',
      plugin: pluginSummary.name,
      serviceOrRoute: pluginSummary.serviceOrRouteName,
      pluginDetails:
        pluginSummary.operation === 'removed'
          ? '-'
          : Object.keys(pluginSummary.config)
              .filter((k) => (pluginSummary.config as any)[k])
              .map((k) => `${k}=${(pluginSummary.config as any)[k]}`)
              .join(', '),
    };
    this.mapDataInputToParams(dataInput, params);

    const message =
      pluginSummary.operation === 'removed'
        ? '{actor} {action} {entity} {plugin} to {serviceOrRoute} for {consumer}'
        : '{actor} {action} {entity} {plugin} to {serviceOrRoute} ({pluginDetails}) for {consumer}';

    const ids = this.mapDataInputToIDs(
      ['consumer', 'environment', 'product'],
      dataInput
    );

    return this.recordActivity(success, message, params, ids);
  }

  public async logDeleteAccess(success: boolean, dataInput: ActivityDataInput) {
    const nsServiceAccount =
      dataInput.environment.appId === process.env.GWA_PROD_ENV_SLUG;

    const { actor } = this;

    if (nsServiceAccount) {
      const message = '{actor} {action} {entity} ({consumer})';
      const params = {
        actor: actor.name,
        action: 'deleted',
        entity: 'namespace service account',
      };
      this.mapDataInputToParams(dataInput, params);

      return this.recordActivity(success, message, params, [
        `consumer:${dataInput.consumerUsername}`,
      ]);
    } else {
      const message =
        '{actor} {action} {entity} to {product} {environment} from {consumer}';
      const params = {
        actor: actor.name,
        action: 'revoked',
        entity: 'access',
      };
      this.mapDataInputToParams(dataInput, params);

      return this.recordActivity(success, message, params, [
        `consumer:${dataInput.consumerUsername}`,
      ]);
    }
  }

  async recordActivity(
    success: boolean,
    message: string,
    params: { [key: string]: string },
    ids: string[]
  ) {
    const { context, namespace } = this;

    assert.strictEqual(
      ids.length > 0 && ids.length < 5,
      true,
      'Must be atleast one id and no more than 4'
    );

    const activityContext = JSON.stringify({
      message,
      params,
    });

    const formattedMessage = format(message, params);
    logger.info('%s (%j)', formattedMessage, ids);

    const result = await recordActivity(
      context,
      params.action,
      params.entity,
      ids[0],
      formattedMessage,
      success ? 'success' : 'failed',
      activityContext,
      namespace,
      ids.concat(`actor:${params.actor}`)
    );
    if (result.errors) {
      logger.error('[recordActivity] %s %j %j', message, params, result);
    }
    return result;
  }
}

export async function getFilteredNamespaceActivity(
  context: any,
  ns: string,
  first: number,
  skip: number,
  filter: ActivityQueryFilter
): Promise<ActivitySummary[]> {
  logger.debug('[getFilteredNamespaceActivity] %s %j', ns, filter);

  const activityQuery = doFiltering(filter);

  const activities = await getActivity(
    context,
    [ns],
    activityQuery,
    first,
    skip
  );
  return transformActivity(activities).map((o) => parseBlobString(o));
}

export function doFiltering(filter: ActivityQueryFilter): ActivityWhereInput {
  const where: ActivityWhereInput[] = [];
  if (filter.consumers && filter.consumers.length > 0) {
    const match = `consumer:${filter.consumers[0]}`;
    where.push(getFilterKeyWhere(match));
  }
  if (filter.serviceAccounts && filter.serviceAccounts.length > 0) {
    const match = `actor:${filter.serviceAccounts[0]}`;
    where.push(getFilterKeyWhere(match));
  }
  if (filter.users && filter.users.length > 0) {
    const match = `actor:${filter.users[0]}`;
    where.push(getFilterKeyWhere(match));
  }
  if (filter.activityDate) {
    where.push(
      {
        createdAt_gte: toISOString(
          `${filter.activityDate}T00:00:00`,
          filter.timeZone
        ),
      },
      {
        createdAt_lt: toISOString(
          `${filter.activityDate}T24:00:00`,
          filter.timeZone
        ),
      }
    );
  }
  if (where.length == 0) {
    return undefined;
  }
  return where.length == 1 ? where[0] : { AND: where };
}

function getFilterKeyWhere(match: string): ActivityWhereInput {
  return {
    OR: [
      { filterKey1: match },
      { filterKey2: match },
      { filterKey3: match },
      { filterKey4: match },
    ],
  } as ActivityWhereInput;
}

function toISOString(pstDate: string, _timeZone: string) {
  const timeZone = _timeZone ? _timeZone : 'America/Los_Angeles';
  const dt = new Date(pstDate);
  const pstTS = new Date(
    dt.toLocaleString('en-us', {
      timeZone,
    })
  );
  return new Date(
    dt.getTime() + (dt.getTime() - pstTS.getTime())
  ).toISOString();
}

export function transformActivity(activities: Activity[]): ActivitySummary[] {
  return activities
    .map((a) => {
      const struct = a.filterKey1
        ? JSON.parse(a.context)
        : { message: a.message, params: {} };

      if (
        a.message === '' &&
        (a.type === 'GatewayConsumerPlugin' || a.type === 'GatewayConfig')
      ) {
        struct.message = `${a.type} Update`;
      }
      return {
        id: a.id,
        result: a.result,
        message: struct.message,
        params: struct.params,
        activityAt: a.createdAt,
        blob: a.blob,
      } as ActivitySummary;
    })
    .map((a) => {
      if (!('actor' in a.params)) {
        a.params['actor'] = 'Unknown Actor';
      }
      return a;
    });
}
