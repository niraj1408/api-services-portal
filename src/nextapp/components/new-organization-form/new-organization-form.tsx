import * as React from 'react';
import {
  Button,
  FormControl,
  FormLabel,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalFooter,
  ModalBody,
  ModalCloseButton,
  Text,
  useDisclosure,
  Select,
  Link,
  useToast,
} from '@chakra-ui/react';
import { useAuth } from '@/shared/services/auth';
import { useApi, useApiMutation } from '@/shared/services/api';
import { useQueryClient } from 'react-query';
import { queryKey } from '@/shared/hooks/use-current-namespace';
import { gql } from 'graphql-request';

const NewOrganizationForm: React.FC = () => {
  const ref = React.useRef<HTMLFormElement>(null);
  const { user } = useAuth();
  const { isOpen, onClose, onOpen } = useDisclosure();
  const mutate = useApiMutation(mutation);
  const client = useQueryClient();
  const toast = useToast();

  const [org, setOrg] = React.useState<string>('');

  const { data, isSuccess } = useApi(
    'org-list',
    {
      query,
    },
    { suspense: false }
  );

  const orgResult = useApi(
    ['org', org],
    {
      query: queryUnits,
      variables: { org },
    },
    { suspense: false }
  );

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (ref.current?.checkValidity()) {
      try {
        const formData = new FormData(ref.current);
        const entries = Object.fromEntries(formData);
        await mutate.mutateAsync(entries);
        client.invalidateQueries(queryKey);
        onClose();
        toast({
          status: 'success',
          title: 'Namespace updated',
        });
      } catch (err) {
        toast({
          status: 'error',
          title: 'Namespace update failed',
          description: err,
        });
      }
    }
  };
  const handleSubmitClick = () => {
    ref.current?.requestSubmit();
  };

  return (
    <>
      <Button onClick={onOpen}>Add Organization</Button>
      <Modal isOpen={isOpen} onClose={onClose} size="2xl">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Add Organization to {user?.namespace}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Text fontSize="sm" mb={4}>
              Adding your Organization and Business Unit to your namespace will
              notify the Organization Administrator to enable API publishing to
              the Directory for your namespace so consumers can find and request
              access to your APIs.
            </Text>
            <Text fontSize="sm" mb={8}>
              The Organization you choose is the organization that your APIs
              will be promoted under.
            </Text>
            <form ref={ref} onSubmit={handleSubmit}>
              <FormControl isRequired mb={4}>
                <FormLabel>Organization</FormLabel>
                <Select
                  name="org"
                  disabled={!isSuccess}
                  onChange={(event) => setOrg(event.target.value)}
                >
                  <option value="">Select an Organization</option>
                  {isSuccess &&
                    data.allOrganizations.map((o) => (
                      <option value={o.name}>{o.title}</option>
                    ))}
                </Select>
              </FormControl>
              <FormControl isRequired>
                <FormLabel>Business Unit</FormLabel>
                <Select
                  isDisabled={
                    orgResult.data?.allOrganizationUnits?.length === 0
                  }
                  name="orgUnit"
                >
                  <option value="">Select a Business Unit</option>
                  {orgResult.isSuccess &&
                    orgResult.data.allOrganizations.length === 1 &&
                    orgResult.data.allOrganizations[0].orgUnits.map((o) => (
                      <option value={o.name}>{o.title}</option>
                    ))}
                </Select>
              </FormControl>
            </form>
            <Text fontSize="sm" mt={8}>
              If you don’t know your Organization or Business Unit or it is not
              listed, please submit a request through the{' '}
              <Link color="bc-link" textDecor="underline">
                Data Systems and Services request system
              </Link>
            </Text>
          </ModalBody>

          <ModalFooter>
            <Button mr={2} onClick={onClose} variant="secondary">
              Cancel
            </Button>
            <Button onClick={handleSubmitClick}>Add</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
};

export default NewOrganizationForm;

const query = gql`
  query ListOrganizations {
    allOrganizations(sortBy: title_ASC) {
      name
      title
    }
  }
`;

const queryUnits = gql`
  query ListOrganizationUnits($org: String!) {
    allOrganizations(where: { name: $org }) {
      orgUnits {
        name
        title
      }
    }
  }
`;

// TODO make this mutation on backend
const mutation = gql`
  mutation UpdateCurrentNamespace($org: String!, $orgUnit: String!) {
    updateCurrentNamespace(org: $org, orgUnit: $orgUnit)
  }
`;
