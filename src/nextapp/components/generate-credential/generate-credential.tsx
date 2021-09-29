import * as React from 'react';
import {
  Alert,
  AlertDescription,
  AlertIcon,
  Box,
  Button,
  Center,
  Heading,
  Icon,
  Text,
} from '@chakra-ui/react';
import { FaKey } from 'react-icons/fa';
import { gql } from 'graphql-request';
import { useApiMutation } from '@/shared/services/api';
import type { Mutation } from '@/shared/types/query.types';

import ViewSecret from '../view-secret';

interface GenerateCredentialsProps {
  id: string;
}

const GenerateCredentials: React.FC<GenerateCredentialsProps> = ({ id }) => {
  const [credentials, setCredentials] = React.useState<Record<string, string>>(
    {}
  );
  const credentialGenerator = useApiMutation(mutation);
  const generateCredentials = React.useCallback(async () => {
    const res: Mutation = await credentialGenerator.mutateAsync({ id });
    if (res.updateAccessRequest.credential !== 'NEW') {
      setCredentials(JSON.parse(res.updateAccessRequest.credential));
    }
  }, [credentialGenerator, id, setCredentials]);

  return (
    <>
      {credentials && (
        <Box my={8}>
          <ViewSecret credentials={credentials} />
          <Alert status="warning" my={4}>
            <AlertIcon />
            <AlertDescription>
              Please store your new API key somewhere safe because as soon as
              you navigate away from this dialog, we will not be able to
              retrieve this token.
            </AlertDescription>
          </Alert>
        </Box>
      )}
      {!credentialGenerator.isSuccess && (
        <>
          <Text>
            By clicking{' '}
            <Text as="strong" color="bc-blue">
              Generate Secrets
            </Text>{' '}
            we will generate your credentials once.
          </Text>
          <Center minH="250px">
            <Box>
              <Button
                isLoading={credentialGenerator.isLoading}
                onClick={generateCredentials}
              >
                {`${
                  credentialGenerator.isError ? 'Retry ' : ''
                }Generate Secrets`}
              </Button>
              {credentialGenerator.isError && (
                <Alert status="error" mt={4}>
                  <AlertDescription>Unable to generate keys</AlertDescription>
                </Alert>
              )}
            </Box>
          </Center>
        </>
      )}
    </>
  );
};

export default GenerateCredentials;

const mutation = gql`
  mutation genCredential($id: ID!) {
    updateAccessRequest(id: $id, data: { credential: "NEW" }) {
      credential
    }
  }
`;
