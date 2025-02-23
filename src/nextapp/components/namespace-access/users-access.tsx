import * as React from 'react';
import {
  Box,
  Heading,
  MenuItem,
  Td,
  Text,
  Tr,
  Tag,
  Flex,
  useToast,
  Wrap,
  WrapItem,
} from '@chakra-ui/react';
import EmptyPane from '@/components/empty-pane';
import { gql } from 'graphql-request';
import groupBy from 'lodash/groupBy';
import NamespaceAccessDialog from './namespace-access-dialog';
import SearchInput from '@/components/search-input';
import Table from '@/components/table';
import { useApi, useApiMutation } from '@/shared/services/api';
import { UmaScope } from '@/shared/types/query.types';
import { useQueryClient } from 'react-query';
import { uid } from 'react-uid';
import ActionsMenu from '../actions-menu';

type AccessItem = {
  requesterName: string;
  tickets: string[];
  scopes: { id: string; name: string }[];
};
interface UsersAccessProps {
  resourceScopes: UmaScope[];
  resourceId: string;
  prodEnvId: string;
}

const UsersAccess: React.FC<UsersAccessProps> = ({
  resourceId,
  resourceScopes,
  prodEnvId,
}) => {
  const queryKey = ['namespaceAccessUsers', resourceId];
  const [search, setSearch] = React.useState('');
  const client = useQueryClient();
  const grant = useApiMutation(mutation);
  const revoke = useApiMutation(revokeMutation);
  const toast = useToast();
  const { data, isLoading, isSuccess } = useApi(
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

  const requests: AccessItem[] = React.useMemo(() => {
    if (isSuccess) {
      const groupedByRequester = groupBy(
        data?.getPermissionTicketsForResource,
        (a) => a.requester + '|' + a.requesterName
      );
      const result = Object.keys(groupedByRequester).map((r) => {
        const requesterName = r.split('|')[1];
        return {
          requesterName,
          scopes: groupedByRequester[r].map((d) => ({
            id: d.scope,
            name: d.scopeName,
          })),
          tickets: groupedByRequester[r].map((d) => d.id),
        };
      });
      if (search) {
        return result.filter((d) => d.requesterName.search(search) >= 0);
      }
      return result;
    }
    return [];
  }, [data, isSuccess, search]);

  const handleGrantAccess = async (form: FormData) => {
    const email = form.get('email') as string;
    const scopes = form.getAll('scopes') as string[];

    try {
      await grant.mutateAsync({
        prodEnvId,
        data: {
          resourceId,
          email,
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
        status: 'error',
        title: 'Unable to grant user access',
        description: err,
        isClosable: true,
      });
    }
  };
  const handleRevokeAccess = (d: AccessItem) => async () => {
    try {
      await revoke.mutateAsync({
        prodEnvId,
        resourceId,
        tickets: d.tickets,
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
    variant: 'user',
  } as const;

  return (
    <>
      <Flex as="header" justify="space-between" px={8} align="center">
        <Heading
          size="sm"
          fontWeight="normal"
          data-testid="nsa-users-count-text"
        >
          {requests?.length ?? '0'} users
        </Heading>
        <Box>
          <SearchInput
            placeholder="Search for User"
            value={search}
            onChange={setSearch}
            data-testid="nsa-users-search"
          />
        </Box>
      </Flex>
      <Table
        sortable
        isUpdating={isLoading}
        emptyView={
          <EmptyPane
            title={search ? '' : 'No users have access yet'}
            message={
              search ? (
                <Text as="em" color="bc-component">
                  No users found
                </Text>
              ) : (
                'Grant user access and assign specific permissions'
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
          { name: 'User', key: 'requesterName' },
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
        {(d: AccessItem, index) => (
          <Tr key={uid(d)} data-testid={`nsa-users-table-row-${index}`}>
            <Td>{d.requesterName}</Td>
            <Td>
              <Wrap>
                {d.scopes.map((s) => (
                  <WrapItem key={uid(s)}>
                    <Tag variant="outline">{s.name}</Tag>
                  </WrapItem>
                ))}
              </Wrap>
            </Td>
            <Td textAlign="right">
              <ActionsMenu
                placement="bottom-end"
                data-testid={`nsa-users-table-row-${index}-menu`}
              >
                <MenuItem
                  color="bc-error"
                  onClick={handleRevokeAccess(d)}
                  data-testid={`nsa-users-table-row-${index}-revoke-btn`}
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

export default UsersAccess;

const query = gql`
  query GetUserPermissions($resourceId: String!, $prodEnvId: ID!) {
    getPermissionTicketsForResource(
      prodEnvId: $prodEnvId
      resourceId: $resourceId
    ) {
      id
      owner
      ownerName
      requester
      requesterName
      resource
      resourceName
      scope
      scopeName
      granted
    }

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

    getOrgPoliciesForResource(prodEnvId: $prodEnvId, resourceId: $resourceId) {
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
  mutation GrantUserAccess($prodEnvId: ID!, $data: UMAPermissionTicketInput!) {
    grantPermissions(prodEnvId: $prodEnvId, data: $data) {
      id
    }
  }
`;

const revokeMutation = gql`
  mutation RevokeAccess(
    $prodEnvId: ID!
    $resourceId: String!
    $tickets: [String]!
  ) {
    revokePermissions(
      prodEnvId: $prodEnvId
      resourceId: $resourceId
      ids: $tickets
    )
  }
`;
