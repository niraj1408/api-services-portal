import * as React from 'react';
import {
  Box,
  Heading,
  Tag,
  Td,
  Text,
  Tr,
  Flex,
  Wrap,
  WrapItem,
  useToast,
  MenuItem,
} from '@chakra-ui/react';
import EmptyPane from '@/components/empty-pane';
import { gql } from 'graphql-request';
import NamespaceAccessDialog from './namespace-access-dialog';
import SearchInput from '@/components/search-input';
import Table from '@/components/table';
import { useApi, useApiMutation } from '@/shared/services/api';
import { UmaPolicy, UmaScope } from '@/shared/types/query.types';
import { useQueryClient } from 'react-query';
import ActionsMenu from '../actions-menu';

interface ServiceAccountsAccessProps {
  resourceScopes: UmaScope[];
  resourceId: string;
  prodEnvId: string;
}

const ServiceAccountsAccess: React.FC<ServiceAccountsAccessProps> = ({
  resourceId,
  resourceScopes,
  prodEnvId,
}) => {
  const queryKey = 'namespaceAccessServiceAccounts';
  const client = useQueryClient();
  const grant = useApiMutation(mutation);
  const revoke = useApiMutation(revokeMutation);
  const toast = useToast();
  const [search, setSearch] = React.useState('');
  const { data, isSuccess, isLoading } = useApi(
    queryKey,
    {
      query,
      variables: {
        resourceId,
        prodEnvId,
      },
    },
    {
      enabled: Boolean(resourceId),
      suspense: false,
      onError(err) {
        toast({
          status: 'error',
          title: 'Unable to load users',
          description: err,
          isClosable: true,
        });
      },
    }
  );

  const requests = React.useMemo(() => {
    if (isSuccess) {
      const result = data?.getUmaPoliciesForResource.filter((policy) =>
        Boolean(policy.clients)
      );
      if (search) {
        return result.filter((d) => d.name.search(search) >= 0);
      }
      return result;
    }
    return [];
  }, [data, isSuccess, search]);
  const handleGrantAccess = async (form: FormData) => {
    const name = form.get('username') as string;
    const scopes = form.getAll('scopes') as string[];

    try {
      await grant.mutateAsync({
        prodEnvId,
        resourceId,
        data: {
          name,
          scopes,
        },
      });
      toast({
        title: 'Access granted',
        status: 'success',
        isClosable: true,
      });
      client.invalidateQueries(queryKey);
    } catch (err) {
      toast({
        isClosable: true,
        status: 'error',
        title: 'Unable to grant access',
        description: err,
      });
    }
  };
  const handleRevokeAccess = (policyId: string) => async () => {
    try {
      await revoke.mutateAsync({
        prodEnvId,
        resourceId,
        policyId,
      });
      toast({
        title: 'Access revoked',
        status: 'success',
        isClosable: true,
      });
      client.invalidateQueries(queryKey);
    } catch (err) {
      toast({
        isClosable: true,
        status: 'error',
        title: 'Unable to revoke access',
        description: err,
      });
    }
  };

  const accessRequestDialogProps = {
    data: resourceScopes,
    onSubmit: handleGrantAccess,
    variant: 'service',
  } as const;

  return (
    <>
      <Flex as="header" justify="space-between" px={8} align="center">
        <Heading size="sm" fontWeight="normal" data-testid="nsa-sa-count-text">
          {requests?.length ?? '0'} service accounts
        </Heading>
        <Box minW="280px">
          <SearchInput
            placeholder="Search for Service Account"
            value={search}
            onChange={setSearch}
            data-testid="nsa-sa-search"
          />
        </Box>
      </Flex>
      <Table
        sortable
        isUpdating={isLoading}
        emptyView={
          <EmptyPane
            title={search ? '' : 'No service accounts have access yet'}
            message={
              search ? (
                <Text as="em" color="bc-component">
                  No service accounts found
                </Text>
              ) : (
                'Grant service account access and assign specific permissions'
              )
            }
            action={
              !search && (
                <NamespaceAccessDialog
                  {...accessRequestDialogProps}
                  buttonVariant="primary"
                />
              )
            }
          />
        }
        columns={[
          { name: 'Subject', key: 'name' },
          { name: 'Permission', key: 'scopeName', sortable: false },
          {
            name: <NamespaceAccessDialog {...accessRequestDialogProps} />,
            key: 'id',
            textAlign: 'right',
            sortable: false,
          },
        ]}
        data={requests}
      >
        {(d: UmaPolicy, index) => (
          <Tr key={index} data-testid={`nsa-sa-table-row-${index}`}>
            <Td>{d.name}</Td>
            <Td>
              <Wrap>
                {d.scopes.map((t) => (
                  <WrapItem key={t}>
                    <Tag variant="outline">{t}</Tag>
                  </WrapItem>
                ))}
              </Wrap>
            </Td>
            <Td textAlign="right">
              <ActionsMenu
                placement="bottom-end"
                data-testid={`nsa-sa-table-row-${index}-menu`}
              >
                <MenuItem
                  color="bc-error"
                  onClick={handleRevokeAccess(d.id)}
                  data-testid={`nsa-sa-table-row-${index}-revoke-btn`}
                >
                  Revoke Access
                </MenuItem>
              </ActionsMenu>
            </Td>
          </Tr>
        )}
      </Table>
    </>
  );
};

export default ServiceAccountsAccess;

const query = gql`
  query GetServiceAccessPermissions($resourceId: String!, $prodEnvId: ID!) {
    getUmaPoliciesForResource(prodEnvId: $prodEnvId, resourceId: $resourceId) {
      id
      name
      description
      type
      logic
      decisionStrategy
      owner
      clients
      users
      groups
      scopes
    }
  }
`;

const mutation = gql`
  mutation GrantSAAccess(
    $prodEnvId: ID!
    $resourceId: String!
    $data: UMAPolicyInput!
  ) {
    createUmaPolicy(
      prodEnvId: $prodEnvId
      resourceId: $resourceId
      data: $data
    ) {
      id
    }
  }
`;

const revokeMutation = gql`
  mutation RevokeSAAccess(
    $prodEnvId: ID!
    $resourceId: String!
    $policyId: String!
  ) {
    deleteUmaPolicy(
      prodEnvId: $prodEnvId
      resourceId: $resourceId
      policyId: $policyId
    )
  }
`;
