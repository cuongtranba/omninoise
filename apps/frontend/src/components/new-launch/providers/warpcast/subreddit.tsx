'use client';

import { FC, useCallback, useState } from 'react';
import { useCustomProviderFunction } from '@gitroom/frontend/components/launches/helpers/use.custom.provider.function';
import { Input } from '@gitroom/react/form/input';
import { useDebouncedCallback } from 'use-debounce';
import { FieldError, get, useWatch } from 'react-hook-form';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
type SubredditErrors = FieldError & Partial<Record<'subreddit', FieldError>>;
export const Subreddit: FC<{
  onChange: (event: {
    target: {
      name: string;
      value: {
        id: string;
        subreddit: string;
        title: string;
        name: string;
        url: string;
        body: string;
        media: any[];
      };
    };
  }) => void;
  name: string;
}> = (props) => {
  const { onChange, name } = props;
  const state = useSettings();
  const split = name.split('.');
  const [loading, setLoading] = useState(false);
  const errors: SubredditErrors | undefined = get(
    state?.formState?.errors,
    `${split?.[0]}.${split?.[1]}.value`
  );
  const [results, setResults] = useState([]);
  const func = useCustomProviderFunction();
  const value = useWatch({
    name,
  });
  const [searchValue, setSearchValue] = useState('');
  const setResult = (result: { id: string; name: string }) => async () => {
    setLoading(true);
    setSearchValue('');
    onChange({
      target: {
        name,
        value: {
          id: String(result.id),
          subreddit: result.name,
          title: '',
          name: '',
          url: '',
          body: '',
          media: [],
        },
      },
    });
    setLoading(false);
  };
  const setTitle = useCallback(
    (e: any) => {
      onChange({
        target: {
          name,
          value: {
            ...value,
            title: e.target.value,
          },
        },
      });
    },
    [value]
  );
  const setURL = useCallback(
    (e: any) => {
      onChange({
        target: {
          name,
          value: {
            ...value,
            url: e.target.value,
          },
        },
      });
    },
    [value]
  );
  const search = useDebouncedCallback(
    useCallback(async (input: HTMLInputElement) => {
      setResults([]);
      if (!input.value) {
        return;
      }
      const results = await func.get('subreddits', { word: input.value });
      setResults(results);
    }, []),
    500
  );
  return (
    <div className="bg-primary p-[20px]">
      {value?.subreddit ? (
        <>
          <Input
            error={errors?.subreddit?.message}
            disableForm={true}
            value={value.subreddit}
            readOnly={true}
            label="Channel"
            name="subreddit"
          />
        </>
      ) : (
        <div className="relative">
          <Input
            placeholder="Channel"
            name="search"
            label="Search Channel"
            readOnly={loading}
            value={searchValue}
            error={errors?.message}
            disableForm={true}
            onInput={async (e) => {
              setSearchValue(e.currentTarget.value);
              await search(e.currentTarget);
            }}
          />
          {!!results.length && !loading && (
            <div className="z-[400] w-full absolute bg-input -mt-[20px] outline-none border-fifth border cursor-pointer">
              {results.map((r: { id: string; name: string }) => (
                <div
                  onClick={setResult(r)}
                  key={r.id}
                  className="px-[16px] py-[5px] hover:bg-secondary"
                >
                  {r.name}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
