const { EnforcementPoint } = require('../../authz/enforcement');

import {
  UMAResourceRegistrationService,
  ResourceSetQuery,
  ResourceSet,
  ResourceSetInput,
} from '../../services/uma2';
import {
  getOrganizationUnit,
  lookupProductEnvironmentServicesBySlug,
  lookupUsersByUsernames,
  recordActivity,
} from '../../services/keystone';
import {
  getEnvironmentContext,
  getResourceSets,
  getNamespaceResourceSets,
  isUserBasedResourceOwners,
  doClientLoginForCredentialIssuer,
  EnvironmentContext,
  getOrgPoliciesForResource,
} from './Common';
import type { TokenExchangeResult } from './Common';
import {
  KeycloakPermissionTicketService,
  KeycloakGroupService,
} from '../../services/keycloak';
import { strict as assert } from 'assert';
import {
  DeleteNamespace,
  DeleteNamespaceValidate,
} from '../../services/workflow/delete-namespace';
import { GWAService } from '../../services/gwaapi';
import {
  camelCaseAttributes,
  transformSingleValueAttributes,
} from '../../services/utils';
import getSubjectToken from '../../auth/auth-token';
import {
  GroupAccessService,
  NamespaceService,
} from '../../services/org-groups';
import { IssuerEnvironmentConfig } from '../../services/workflow/types';
import { Keystone } from '@keystonejs/keystone';
import { Logger } from '../../logger';
import { getGwaProductEnvironment } from '../../services/workflow';
import { NotificationService } from '../../services/notification/notification.service';
import { ConfigService } from '../../services/config.service';

const logger = Logger('ext.Namespace');

const typeUserContact = `
  type UserContact {
    id: ID!
    name: String!
    username: String!
    email: String
  }`;

const typeNamespace = `
type Namespace {
    id: String
    name: String!,
    scopes: [UMAScope],
    prodEnvId: String,
    permDomains: [String],
    permDataPlane: String,
    permProtectedNs: String,
    org: JSON,
    orgUnit: JSON
    orgUpdatedAt: Float,
    orgEnabled: Boolean,
    orgNoticeViewed: Boolean,
    orgAdmins: [String],
}
`;

const typeNamespaceInput = `
input NamespaceInput {
    name: String!,
}
`;

module.exports = {
  extensions: [
    (keystone: any) => {
      keystone.extendGraphQLSchema({
        types: [
          { type: typeNamespace },
          { type: typeNamespaceInput },
          { type: typeUserContact },
        ],
        queries: [
          {
            schema: 'currentNamespace: Namespace',
            resolver: async (
              item: any,
              args: any,
              context: any,
              info: any,
              { query, access }: any
            ) => {
              if (
                context.req.user?.namespace == null ||
                typeof context.req.user?.namespace === 'undefined'
              ) {
                return null;
              }

              const selectedNS = context.req.user.namespace;

              const noauthContext = context.createContext({
                skipAccessControl: true,
              });
              const prodEnv = await lookupProductEnvironmentServicesBySlug(
                noauthContext,
                process.env.GWA_PROD_ENV_SLUG
              );
              const envCtx = await getEnvironmentContext(
                context,
                prodEnv.id,
                access
              );

              const kcGroupService = await getKeycloakGroupApi(
                envCtx.issuerEnvConfig
              );

              const client = new GWAService(process.env.GWA_API_URL);
              const defaultSettings = await client.getDefaultNamespaceSettings();

              const merged = await backfillGroupAttributes(
                selectedNS,
                { name: selectedNS, prodEnvId: prodEnv.id },
                defaultSettings,
                kcGroupService
              );
              const getOrgAdmins = true;
              if (getOrgAdmins) {
                const resource: any = await getResource(selectedNS, envCtx);
                merged['id'] = resource['id'];
                merged['scopes'] = resource['scopes'];
              }

              if (merged.org) {
                await transformOrgAndOrgUnit(
                  context,
                  envCtx,
                  merged,
                  getOrgAdmins
                );
              }
              return merged;
            },
            access: EnforcementPoint,
          },
          {
            schema: 'allNamespaces: [Namespace]',
            resolver: async (
              item: any,
              args: any,
              context: any,
              info: any,
              { query, access }: any
            ) => {
              const noauthContext = context.createContext({
                skipAccessControl: true,
              });
              const prodEnv = await lookupProductEnvironmentServicesBySlug(
                noauthContext,
                process.env.GWA_PROD_ENV_SLUG
              );
              const envCtx = await getEnvironmentContext(
                context,
                prodEnv.id,
                access
              );

              const resourceIds = await getNamespaceResourceSets(envCtx);
              const resourcesApi = new UMAResourceRegistrationService(
                envCtx.uma2.resource_registration_endpoint,
                envCtx.accessToken
              );
              const namespaces = await resourcesApi.listResourcesByIdList(
                resourceIds
              );

              const nsList = namespaces.map((ns: ResourceSet) => ({
                id: ns.id,
                name: ns.name,
                scopes: ns.resource_scopes,
                prodEnvId: prodEnv.id,
              }));

              const kcGroupService = await getKeycloakGroupApi(
                envCtx.issuerEnvConfig
              );

              const client = new GWAService(process.env.GWA_API_URL);
              const defaultSettings = await client.getDefaultNamespaceSettings();

              return await Promise.all(
                nsList.map(async (nsdata: any) => {
                  return backfillGroupAttributes(
                    nsdata.name,
                    nsdata,
                    defaultSettings,
                    kcGroupService
                  );
                })
              );
            },
            access: EnforcementPoint,
          },
          {
            schema: 'namespace(ns: String!): Namespace',
            resolver: async (
              item: any,
              args: any,
              context: any,
              info: any,
              { query, access }: any
            ) => {
              const noauthContext = context.createContext({
                skipAccessControl: true,
              });
              const prodEnv = await lookupProductEnvironmentServicesBySlug(
                noauthContext,
                process.env.GWA_PROD_ENV_SLUG
              );
              const envCtx = await getEnvironmentContext(
                context,
                prodEnv.id,
                access
              );

              const detail: any = await getResource(args.ns, envCtx);
              detail['prodEnvId'] = prodEnv.id;

              const kcGroupService = await getKeycloakGroupApi(
                envCtx.issuerEnvConfig
              );

              const client = new GWAService(process.env.GWA_API_URL);
              const defaultSettings = await client.getDefaultNamespaceSettings();

              const merged = await backfillGroupAttributes(
                args.ns,
                detail,
                defaultSettings,
                kcGroupService
              );

              if (merged.org) {
                await transformOrgAndOrgUnit(context, envCtx, merged, true);
              }

              logger.debug('[namespace] Result %j', merged);
              return merged;
            },
            access: EnforcementPoint,
          },
          {
            schema:
              'usersByNamespace(namespace: String!, scopeName: String): [UserContact]',
            resolver: async (
              item: any,
              args: any,
              context: any,
              info: any,
              { query, access }: any
            ) => {
              const namespaceValidationRule = '^[a-z][a-z0-9-]{4,14}$';
              const re = new RegExp(namespaceValidationRule);
              assert.strictEqual(
                re.test(args.namespace),
                true,
                'Namespace name must be between 5 and 15 alpha-numeric lowercase characters and begin with an alphabet.'
              );
              const noauthContext = context.createContext({
                skipAccessControl: true,
              });

              const prodEnv = await lookupProductEnvironmentServicesBySlug(
                noauthContext,
                process.env.GWA_PROD_ENV_SLUG
              );

              const tokenResult: TokenExchangeResult = await doClientLoginForCredentialIssuer(
                noauthContext,
                prodEnv.id
              );

              const kcprotectApi = new UMAResourceRegistrationService(
                tokenResult.resourceRegistrationEndpoint,
                tokenResult.accessToken
              );
              const resOwnerResourceIds = await kcprotectApi.listResources({
                owner: tokenResult.clientUuid,
                type: 'namespace',
              } as ResourceSetQuery);

              const namespaces = await kcprotectApi.listResourcesByIdList(
                resOwnerResourceIds
              );

              const matched = namespaces
                .filter((ns) => ns.name == args.namespace)
                .map((ns) => ({
                  id: ns.id,
                  name: ns.name,
                  scopes: ns.resource_scopes,
                  prodEnvId: prodEnv.id,
                }));
              const namespaceObj = matched[0];
              const permissionApi = new KeycloakPermissionTicketService(
                tokenResult.issuer,
                tokenResult.accessToken
              );
              const params = { resourceId: namespaceObj.id, returnNames: true };
              let permissions = await permissionApi.listPermissions(params);
              if (args.scopeName) {
                const updatedPermissions = permissions.filter((perm) => {
                  return perm.scopeName == args.scopeName;
                });
                permissions = updatedPermissions;
              }
              const usernameList = permissions
                .filter((p) => p.granted)
                .map((p) => p.requesterName);

              return await lookupUsersByUsernames(noauthContext, usernameList);
            },
            access: EnforcementPoint,
          },
        ],
        mutations: [
          {
            schema: 'markNamespaceNotificationViewed: Boolean',
            resolver: async (
              item: any,
              { org, orgUnit }: any,
              context: any,
              info: any,
              { query, access }: any
            ): Promise<boolean> => {
              const selectedNS = context.req.user.namespace;

              const noauthContext = context.createContext({
                skipAccessControl: true,
              });
              const prodEnv = await lookupProductEnvironmentServicesBySlug(
                noauthContext,
                process.env.GWA_PROD_ENV_SLUG
              );
              const envCtx = await getEnvironmentContext(
                context,
                prodEnv.id,
                access
              );

              const nsService = new NamespaceService(envCtx.openid.issuer);
              await nsService.login(
                envCtx.issuerEnvConfig.clientId,
                envCtx.issuerEnvConfig.clientSecret
              );

              await nsService.markNotification(selectedNS, true);

              return true;
            },
          },
          {
            schema:
              'updateCurrentNamespace(org: String, orgUnit: String): String',
            resolver: async (
              item: any,
              { org, orgUnit }: any,
              context: any,
              info: any,
              { query, access }: any
            ): Promise<boolean> => {
              if (
                context.req.user?.namespace == null ||
                typeof context.req.user?.namespace === 'undefined'
              ) {
                return null;
              }

              const ns = context.req.user?.namespace;

              const prodEnv = await getGwaProductEnvironment(context, true);
              const envConfig = prodEnv.issuerEnvConfig;

              const svc = new GroupAccessService(prodEnv.uma2);
              await svc.login(envConfig.clientId, envConfig.clientSecret);
              const result = await svc.assignNamespace(ns, org, orgUnit, false);

              if (result) {
                logger.info(
                  '[updateCurrentNamespace] Sending Notifications for %s',
                  ns
                );

                const nc = new NotificationService(new ConfigService());

                const resourceIds = await getNamespaceResourceSets(prodEnv); // sets accessToken
                const resourcesApi = new UMAResourceRegistrationService(
                  prodEnv.uma2.resource_registration_endpoint,
                  prodEnv.accessToken
                );
                const namespaces = await resourcesApi.listResourcesByIdList(
                  resourceIds
                );

                const detail = namespaces
                  .filter((resns) => resns.name === ns)
                  .map((resns: ResourceSet) => ({
                    id: resns.id,
                  }))
                  .pop();

                const orgPolicies = await getOrgPoliciesForResource(
                  prodEnv,
                  detail.id
                );
                const orgAdmins: string[] = [];
                orgPolicies.map((policy) => {
                  orgAdmins.push(...policy.users);
                });
                const userContactList: string[] = [...new Set(orgAdmins)];
                logger.info(
                  '[updateCurrentNamespace] Sending Notifications to %j',
                  userContactList
                );

                userContactList.forEach((contact) => {
                  nc.notify(
                    { email: contact, name: contact, username: '' },
                    {
                      template: 'new-namespace-approval',
                      subject: `New Namespace Approval - ${ns}`,
                    }
                  );
                });
              }
            },
          },
          {
            schema: 'createNamespace(namespace: String!): Namespace',
            resolver: async (
              item: any,
              args: any,
              context: any,
              info: any,
              { query, access }: any
            ) => {
              const namespaceValidationRule = '^[a-z][a-z0-9-]{4,14}$';
              const re = new RegExp(namespaceValidationRule);
              assert.strictEqual(
                re.test(args.namespace),
                true,
                'Namespace name must be between 5 and 15 alpha-numeric lowercase characters and begin with an alphabet.'
              );

              const noauthContext = context.createContext({
                skipAccessControl: true,
              });
              const prodEnv = await lookupProductEnvironmentServicesBySlug(
                noauthContext,
                process.env.GWA_PROD_ENV_SLUG
              );
              const envCtx = await getEnvironmentContext(
                context,
                prodEnv.id,
                access
              );

              const nsService = new NamespaceService(
                envCtx.issuerEnvConfig.issuerUrl
              );
              await nsService.login(
                envCtx.issuerEnvConfig.clientId,
                envCtx.issuerEnvConfig.clientSecret
              );
              await nsService.checkNamespaceAvailable(args.namespace);

              // This function gets all resources but also sets the accessToken in envCtx
              // which we need to create the resource set
              await getResourceSets(envCtx);

              const resourceApi = new UMAResourceRegistrationService(
                envCtx.uma2.resource_registration_endpoint,
                envCtx.accessToken
              );

              const scopes: string[] = [
                'Namespace.Manage',
                'Namespace.View',
                'GatewayConfig.Publish',
                'Access.Manage',
                'Content.Publish',
                'CredentialIssuer.Admin',
              ];
              const res = <ResourceSetInput>{
                name: args.namespace,
                type: 'namespace',
                resource_scopes: scopes,
                ownerManagedAccess: true,
              };

              const rset = await resourceApi.createResourceSet(res);

              if (isUserBasedResourceOwners(envCtx) == false) {
                const permissionApi = new KeycloakPermissionTicketService(
                  envCtx.issuerEnvConfig.issuerUrl,
                  envCtx.accessToken
                );
                await permissionApi.createPermission(
                  rset.id,
                  envCtx.subjectUuid,
                  true,
                  'Namespace.Manage'
                );
              }

              const kcGroupService = new KeycloakGroupService(
                envCtx.issuerEnvConfig.issuerUrl
              );
              await kcGroupService.login(
                envCtx.issuerEnvConfig.clientId,
                envCtx.issuerEnvConfig.clientSecret
              );

              await kcGroupService.createIfMissing('ns', args.namespace);

              await recordActivity(
                context.sudo(),
                'create',
                'Namespace',
                args.namespace,
                `Created ${args.namespace} namespace`,
                'success',
                JSON.stringify({
                  message: '{actor} created {ns} namespace',
                  params: {
                    actor: context.authedItem.name,
                    ns: args.namespace,
                  },
                }),
                args.namespace,
                [
                  `Namespace:${args.namespace}`,
                  `actor:${context.authedItem.name}`,
                ]
              );

              return rset;
            },
            access: EnforcementPoint,
          },
          {
            schema:
              'forceDeleteNamespace(namespace: String!, force: Boolean!): Boolean',
            resolver: async (
              item: any,
              args: any,
              context: any,
              info: any,
              { query, access }: any
            ): Promise<boolean> => {
              const noauthContext = context.createContext({
                skipAccessControl: true,
              });
              const prodEnv = await lookupProductEnvironmentServicesBySlug(
                noauthContext,
                process.env.GWA_PROD_ENV_SLUG
              );
              const envCtx = await getEnvironmentContext(
                context,
                prodEnv.id,
                access
              );

              const resourceIds = await getResourceSets(envCtx);

              const resourcesApi = new UMAResourceRegistrationService(
                envCtx.uma2.resource_registration_endpoint,
                envCtx.accessToken
              );

              const namespaces = await resourcesApi.listResourcesByIdList(
                resourceIds
              );
              const nsResource = namespaces.filter(
                (ns) => ns.name === args.namespace
              );
              assert.strictEqual(nsResource.length, 1, 'Invalid Namespace');

              if (args.force === false) {
                await DeleteNamespaceValidate(
                  context.createContext({ skipAccessControl: true }),
                  args.namespace
                );
              }
              await DeleteNamespace(
                context.sudo(),
                getSubjectToken(context.req),
                args.namespace
              );
              resourcesApi.deleteResourceSet(nsResource[0].id);

              // Last thing to do is mark the Namespace group 'decommissioned'
              const nsService = new NamespaceService(
                envCtx.issuerEnvConfig.issuerUrl
              );
              await nsService.login(
                envCtx.issuerEnvConfig.clientId,
                envCtx.issuerEnvConfig.clientSecret
              );
              await nsService.markNamespaceAsDecommissioned(args.namespace);

              return true;
            },
            access: EnforcementPoint,
          },
        ],
      });
    },
  ],
};

async function getKeycloakGroupApi(
  issuerEnvConfig: IssuerEnvironmentConfig
): Promise<KeycloakGroupService> {
  const kcGroupService = new KeycloakGroupService(issuerEnvConfig.issuerUrl);
  await kcGroupService.login(
    issuerEnvConfig.clientId,
    issuerEnvConfig.clientSecret
  );
  await kcGroupService.cacheGroups();
  return kcGroupService;
}

async function backfillGroupAttributes(
  ns: string,
  detail: any,
  defaultSettings: any,
  kcGroupService: KeycloakGroupService
): Promise<any> {
  const nsPermissions = await kcGroupService.getGroup('ns', ns);

  transformSingleValueAttributes(nsPermissions.attributes, [
    'perm-data-plane',
    'perm-protected-ns',
    'org',
    'org-unit',
    'org-enabled',
    'org-notice-viewed',
    'org-updated-at',
  ]);

  logger.debug(
    '[backfillGroupAttributes] %s attributes %j',
    ns,
    nsPermissions.attributes
  );

  const merged = {
    ...detail,
    ...defaultSettings,
    ...{ 'org-enabled': false },
    ...nsPermissions.attributes,
    ...{
      'org-enabled':
        'org-enabled' in nsPermissions.attributes &&
        nsPermissions.attributes['org-enabled'] === 'true'
          ? true
          : false,
      'org-notice-viewed':
        'org-notice-viewed' in nsPermissions.attributes &&
        nsPermissions.attributes['org-notice-viewed'] === 'true',
      'org-admins': null,
    },
  };

  camelCaseAttributes(merged, [
    'perm-domains',
    'perm-data-plane',
    'perm-protected-ns',
    'org',
    'org-unit',
    'org-updated-at',
    'org-enabled',
    'org-notice-viewed',
    'org-admins',
  ]);

  return merged;
}

async function transformOrgAndOrgUnit(
  context: Keystone,
  envCtx: EnvironmentContext,
  merged: any,
  getOrgAdmins: boolean
): Promise<void> {
  const orgInfo = await getOrganizationUnit(context, merged.orgUnit);
  if (orgInfo) {
    merged['org'] = { name: orgInfo.name, title: orgInfo.title };
    merged['orgUnit'] = {
      name: orgInfo.orgUnits[0].name,
      title: orgInfo.orgUnits[0].title,
    };
  } else {
    merged['org'] = { name: merged.org, title: merged.org };
    merged['orgUnit'] = { name: merged.orgUnit, title: merged.orgUnit };
  }

  // lookup org admins from
  if (getOrgAdmins && merged.id) {
    const orgPolicies = await getOrgPoliciesForResource(envCtx, merged.id);
    const orgAdmins: string[] = [];
    orgPolicies.map((policy) => {
      orgAdmins.push(...policy.users);
    });
    merged['orgAdmins'] = [...new Set(orgAdmins)];
  }
}

async function getResource(selectedNS: string, envCtx: EnvironmentContext) {
  const resourceIds = await getNamespaceResourceSets(envCtx);
  const resourcesApi = new UMAResourceRegistrationService(
    envCtx.uma2.resource_registration_endpoint,
    envCtx.accessToken
  );
  const namespaces = await resourcesApi.listResourcesByIdList(resourceIds);

  return namespaces
    .filter((ns) => ns.name === selectedNS)
    .map((ns: ResourceSet) => ({
      id: ns.id,
      name: ns.name,
      scopes: ns.resource_scopes,
    }))
    .pop();
}
